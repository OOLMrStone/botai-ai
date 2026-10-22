package org.botai.back.billing;

import static org.botai.back.billing.BillingDtos.*;

import java.sql.Timestamp;
import java.util.*;
import org.botai.back.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class BillingEntitlements {
  private final JdbcTemplate db;
  private final BillingConfig config;
  private final BillingClock clock;

  public BillingEntitlements(JdbcTemplate db, BillingConfig config, BillingClock clock) {
    this.db = db;
    this.config = config;
    this.clock = clock;
  }

  public boolean allowed(UUID user) {
    if (!config.enabled) return false;
    return db
        .query(
            "SELECT email FROM users WHERE id=? AND enabled AND email_verified",
            (r, n) -> r.getString(1),
            user)
        .stream()
        .anyMatch(config::permits);
  }

  private static final String COUNTS =
      "SELECT e.*, (SELECT count(*) FROM billing_test_usage u JOIN billing_test_usage_settlements s"
          + " ON s.submission_id=u.submission_id WHERE u.payment_id=e.payment_id AND"
          + " s.outcome='consume') AS used, (SELECT count(*) FROM billing_test_usage u WHERE"
          + " u.payment_id=e.payment_id AND NOT EXISTS(SELECT 1 FROM billing_test_usage_settlements"
          + " s WHERE s.submission_id=u.submission_id)) AS reserved FROM billing_test_entitlements"
          + " e ";

  public Entitlement active(UUID user) {
    if (!allowed(user)) return null;
    var rows = activeRows(user);
    return rows.isEmpty() ? null : dto(rows.getFirst());
  }

  Entitlement forPayment(UUID id) {
    return dto(db.queryForMap(COUNTS + "WHERE e.payment_id=?", id));
  }

  private List<Map<String, Object>> activeRows(UUID user) {
    var now = Timestamp.from(clock.now());
    return db.queryForList(
        COUNTS
            + "WHERE e.user_id=? AND e.starts_at<=? AND e.expires_at>? ORDER BY e.expires_at DESC"
            + " LIMIT 1",
        user,
        now,
        now);
  }

  private Entitlement dto(Map<String, Object> row) {
    int total = ((Number) row.get("checks_total")).intValue(),
        used = ((Number) row.get("used")).intValue(),
        reserved = ((Number) row.get("reserved")).intValue();
    return new Entitlement(
        (String) row.get("plan"),
        ((Timestamp) row.get("starts_at")).toInstant(),
        ((Timestamp) row.get("expires_at")).toInstant(),
        total,
        used,
        reserved,
        Math.max(0, total - used - reserved));
  }

  public boolean enabled() {
    return config.enabled;
  }

  public boolean hasAccess(UUID user) {
    var active = active(user);
    return active != null && active.checksRemaining() > 0;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public ApiException reserve(UUID user, UUID submission, String providerMode) {
    if (!allowed(user) || !"mock".equals(providerMode))
      return new ApiException(
          403,
          "billing_sandbox_required",
          "Тестовая покупка действует только для тестовых проверок");
    db.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", UUID.class, user);
    if (db.queryForObject(
            "SELECT count(*) FROM billing_test_usage WHERE submission_id=?",
            Integer.class,
            submission)
        > 0) return null;
    var rows = activeRows(user);
    if (rows.isEmpty())
      return new ApiException(403, "ai_review_required", "Нужна действующая тестовая покупка");
    var row = rows.getFirst();
    if (dto(row).checksRemaining() == 0)
      return new ApiException(429, "billing_quota_exhausted", "Тестовые проверки закончились");
    db.update(
        "INSERT INTO billing_test_usage(submission_id,payment_id,consumed_at) VALUES(?,?,?)",
        submission,
        row.get("payment_id"),
        Timestamp.from(clock.now()));
    return null;
  }

  public boolean hasReservation(UUID id) {
    return config.enabled
        && db.queryForObject(
                "SELECT count(*) FROM billing_test_usage WHERE submission_id=?", Integer.class, id)
            > 0;
  }

  /**
   * Called in the same transaction that persists the result or fences and seals final no-result
   * work.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void settle(UUID submission) {
    if (!config.enabled) return;
    var statuses =
        db.query(
            "SELECT status FROM grading_submissions WHERE id=? FOR UPDATE",
            (r, n) -> r.getString(1),
            submission);
    if (statuses.isEmpty()
        || db.query(
                "SELECT submission_id FROM billing_test_usage WHERE submission_id=? FOR UPDATE",
                (r, n) -> r.getObject(1, UUID.class),
                submission)
            .isEmpty()) return;
    if (db.queryForObject(
            "SELECT count(*) FROM billing_test_usage_settlements WHERE submission_id=?",
            Integer.class,
            submission)
        > 0) return;
    var jobs =
        db.queryForList(
            "SELECT state,lease_until FROM grading_jobs WHERE submission_id=? FOR UPDATE",
            submission);
    if (jobs.isEmpty()
        || !"done".equals(jobs.getFirst().get("state"))
        || jobs.getFirst().get("lease_until") != null) return;
    if (db.queryForObject(
            "SELECT count(*) FROM grading_runs WHERE submission_id=? AND (outcome IS NULL OR"
                + " finished_at IS NULL)",
            Integer.class,
            submission)
        > 0) return;
    boolean graded =
        db.queryForObject(
                "SELECT count(*) FROM grading_results WHERE submission_id=? AND is_graded",
                Integer.class,
                submission)
            > 0;
    String status = statuses.getFirst();
    if (graded && !status.equals("graded")) return;
    if (!graded
        && !Set.of("failed", "rejected", "cancelled", "expired", "unsupported").contains(status))
      return;
    db.update(
        "INSERT INTO billing_test_usage_settlements(submission_id,outcome,reason,settled_at)"
            + " VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
        submission,
        graded ? "consume" : "release",
        graded ? "graded_result" : "no_result_finalized",
        Timestamp.from(clock.now()));
  }
}
