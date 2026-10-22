package org.botai.back.billing;

import static org.botai.back.billing.BillingDtos.*;

import java.math.BigDecimal;
import java.net.URI;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.botai.back.common.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

@Service
public class BillingService {
  private static final org.slf4j.Logger LOG =
      org.slf4j.LoggerFactory.getLogger(BillingService.class);
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final BillingConfig config;
  private final BillingClock clock;
  private final BillingGateway gateway;
  private final BillingEntitlements entitlements;
  private final JsonCodec json;
  private final boolean reconcilerEnabled;
  private static final Set<String> TERMINAL = Set.of("succeeded", "canceled");

  public BillingService(
      JdbcTemplate db,
      TransactionTemplate tx,
      BillingConfig config,
      BillingClock clock,
      BillingGateway gateway,
      BillingEntitlements entitlements,
      JsonCodec json,
      @org.springframework.beans.factory.annotation.Value("${app.billing.reconciler-enabled:true}")
          boolean reconcilerEnabled) {
    this.db = db;
    this.tx = tx;
    this.config = config;
    this.clock = clock;
    this.gateway = gateway;
    this.entitlements = entitlements;
    this.json = json;
    this.reconcilerEnabled = reconcilerEnabled;
  }

  private record Row(
      UUID id,
      UUID user,
      Offer offer,
      String shopId,
      UUID providerKey,
      String providerId,
      String status,
      String confirmationUrl,
      Instant createdAt,
      Instant firstDispatch,
      String cancellationReason,
      UUID leaseToken,
      String providerRequest,
      UUID subscriptionId,
      String purpose,
      Integer sequence) {}

  private record Sub(
      UUID id,
      UUID user,
      String shopId,
      String status,
      boolean enabled,
      Instant revoked,
      int revision,
      String method,
      Instant due,
      String action,
      boolean earlyUsed) {}

  public Offers offers(UUID user) {
    boolean allowed = entitlements.allowed(user);
    return new Offers(
        allowed ? "test" : "disabled",
        true,
        allowed ? BillingOffers.available(clock.now()) : List.of());
  }

  public Status status(UUID user) {
    if (!entitlements.allowed(user)) return new Status("disabled", true, null, false, null, null);
    var pending = pendingPayment(user);
    var purchases =
        db.queryForList(
            "SELECT subscription_id FROM billing_test_payments WHERE user_id=? ORDER BY created_at"
                + " DESC,id DESC LIMIT 1",
            user);
    UUID latestSub =
        purchases.isEmpty() ? null : (UUID) purchases.getFirst().get("subscription_id");
    return new Status(
        "test",
        true,
        entitlements.active(user),
        !purchaseBlocked(user),
        pending,
        latestSub == null ? null : subscription(user, latestSub));
  }

  private UUID pendingPayment(UUID user) {
    return db
        .query(
            "SELECT id FROM billing_test_payments WHERE user_id=? AND status NOT"
                + " IN('succeeded','canceled') ORDER BY created_at DESC LIMIT 1",
            (r, n) -> r.getObject(1, UUID.class),
            user)
        .stream()
        .findFirst()
        .orElse(null);
  }

  private boolean purchaseBlocked(UUID user) {
    return pendingPayment(user) != null
        || db.queryForObject(
                "SELECT count(*) FROM billing_test_entitlements WHERE user_id=? AND expires_at>?",
                Integer.class,
                user,
                timestamp(clock.now()))
            > 0
        || db.queryForObject(
                "SELECT count(*) FROM billing_test_subscriptions WHERE user_id=? AND"
                    + " (renewal_enabled OR status='pending_initial')",
                Integer.class,
                user)
            > 0;
  }

  private void permitted(UUID user) {
    if (!entitlements.allowed(user))
      throw new ApiException(
          403, "billing_unavailable", "Тестовая оплата недоступна для этого аккаунта");
  }

  private void lockUser(UUID user) {
    if (db.query(
            "SELECT id FROM users WHERE id=? AND enabled FOR UPDATE",
            (r, n) -> r.getObject(1, UUID.class),
            user)
        .isEmpty()) throw ApiException.notFound();
  }

  private void key(String key) {
    if (key == null || !key.matches("[a-zA-Z0-9_-]{1,64}"))
      throw ApiException.invalid("Нужен ключ повторного запроса до 64 символов");
  }

  private Row prior(UUID user, String key) {
    var ids =
        db.query(
            "SELECT id FROM billing_test_payments WHERE user_id=? AND idempotency_key=?",
            (r, n) -> r.getObject(1, UUID.class),
            user,
            key);
    return ids.isEmpty() ? null : row(ids.getFirst(), false);
  }

  public Payment create(UUID user, String key, Create input) {
    permitted(user);
    key(key);
    UUID id =
        tx.execute(
            t -> {
              lockUser(user);
              permitted(user);
              var prior = prior(user, key);
              if (prior != null) {
                if (!prior.offer().id().equals(input.offerId())
                    || !prior.purpose().equals("one_time"))
                  throw ApiException.conflict("idempotency_conflict");
                return prior.id();
              }
              if (purchaseBlocked(user))
                throw ApiException.conflict("billing_purchase_unavailable");
              var offer = BillingOffers.find(input.offerId(), clock.now());
              if (!offer.kind().equals("one_time"))
                throw ApiException.invalid("Для подписки нужно отдельное согласие");
              return insertPayment(user, key, offer, null, "one_time", null);
            });
    resume(id);
    return get(user, id);
  }

  public SubscriptionCreated createSubscription(UUID user, String key, CreateSubscription input) {
    permitted(user);
    key(key);
    if (input.consent() == null || !input.consent().accepted())
      throw new ApiException(
          400, "recurring_consent_required", "Подтвердите согласие на автоплатежи");
    UUID payment =
        tx.execute(
            t -> {
              lockUser(user);
              permitted(user);
              var prior = prior(user, key);
              if (prior != null) {
                if (!prior.offer().id().equals(input.offerId())
                    || !prior.purpose().equals("subscription_initial")
                    || !Objects.equals(prior.offer().consentVersion(), input.consent().version()))
                  throw ApiException.conflict("idempotency_conflict");
                return prior.id();
              }
              if (!BillingOffers.CONSENT_VERSION.equals(input.consent().version()))
                throw ApiException.conflict("recurring_consent_changed");
              if (purchaseBlocked(user))
                throw ApiException.conflict("billing_purchase_unavailable");
              Offer offer = BillingOffers.find(input.offerId(), clock.now());
              if (!offer.kind().equals("subscription"))
                throw ApiException.invalid("Это разовый пакет");
              UUID sub = UUID.randomUUID();
              String consent = BillingOffers.consentText(offer);
              db.update(
                  "INSERT INTO"
                      + " billing_test_subscriptions(id,user_id,shop_id,consent_version,consent_text,consent_hash,consent_accepted_at,status,created_at)"
                      + " VALUES(?,?,?,?,?,?,?,'pending_initial',?)",
                  sub,
                  user,
                  config.shopId,
                  input.consent().version(),
                  consent,
                  JsonCodec.sha256(consent),
                  timestamp(clock.now()),
                  timestamp(clock.now()));
              return insertPayment(user, key, offer, sub, "subscription_initial", null);
            });
    resume(payment);
    var result = get(user, payment);
    return new SubscriptionCreated(subscription(user, result.subscriptionId()), result);
  }

  private UUID insertPayment(
      UUID user, String key, Offer offer, UUID sub, String purpose, String method) {
    UUID id = UUID.randomUUID();
    String returnUrl = config.origin + "/billing/return?paymentId=" + id;
    var payload = new LinkedHashMap<String, Object>();
    payload.put("amount", offer.amount());
    payload.put("capture", true);
    payload.put("description", "BotAI: тестовая оплата " + offer.id());
    payload.put("metadata", Map.of("botai_order_id", id.toString()));
    if (method == null)
      payload.put(
          "confirmation", Map.of("type", "redirect", "return_url", returnUrl, "locale", "ru_RU"));
    else payload.put("payment_method_id", method);
    if (purpose.equals("subscription_initial")) payload.put("save_payment_method", true);
    db.update(
        "INSERT INTO"
            + " billing_test_payments(id,user_id,idempotency_key,offer_id,plan,period,amount_minor,checks_total,duration_days,fixed_expiry,return_url,shop_id,provider_key,provider_request,created_at,next_check_at,subscription_id,purpose)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        user,
        key,
        offer.id(),
        offer.plan(),
        offer.period(),
        new BigDecimal(offer.amount().value()).movePointRight(2).intValueExact(),
        offer.checkLimit(),
        offer.durationDays(),
        timestamp(offer.expiresAt()),
        returnUrl,
        config.shopId,
        UUID.randomUUID(),
        json.write(payload),
        timestamp(clock.now()),
        timestamp(clock.now()),
        sub,
        purpose);
    if (sub != null) {
      int sequence =
          db.queryForObject(
              "SELECT coalesce(max(sequence),0)+1 FROM billing_test_subscription_periods WHERE"
                  + " subscription_id=?",
              Integer.class,
              sub);
      db.update(
          "INSERT INTO billing_test_subscription_periods(subscription_id,sequence,payment_id)"
              + " VALUES(?,?,?)",
          sub,
          sequence,
          id);
    }
    return id;
  }

  private void resume(UUID id) {
    try {
      reconcile(id);
    } catch (ApiException ignored) {
      /* Durable same-key operation survives network failures. */
    }
  }

  public Payment get(UUID user, UUID id) {
    permitted(user);
    var row = row(id, false);
    if (!row.user().equals(user)) throw ApiException.notFound();
    return dto(row);
  }

  public Payment refresh(UUID user, UUID id) {
    get(user, id);
    reconcile(id);
    return get(user, id);
  }

  private Payment dto(Row row) {
    boolean applied =
        db.queryForObject(
                "SELECT count(*) FROM billing_test_entitlements WHERE payment_id=?",
                Integer.class,
                row.id())
            == 1;
    return new Payment(
        row.id(),
        row.offer().id(),
        row.offer(),
        row.status(),
        row.offer().amount(),
        true,
        row.confirmationUrl(),
        applied,
        row.createdAt(),
        row.cancellationReason(),
        row.purpose(),
        row.subscriptionId(),
        row.sequence());
  }

  private Row row(UUID id, boolean lock) {
    return db
        .query(
            "SELECT p.*,(SELECT consent_version FROM billing_test_subscriptions b WHERE"
                + " b.id=p.subscription_id) AS consent_version,(SELECT sequence FROM"
                + " billing_test_subscription_periods s WHERE s.payment_id=p.id) AS sequence FROM"
                + " billing_test_payments p WHERE p.id=?"
                + (lock ? " FOR UPDATE OF p" : ""),
            (r, n) -> {
              boolean recurring = !r.getString("purpose").equals("one_time");
              Integer days = (Integer) r.getObject("duration_days");
              Instant fixed = instant(r.getTimestamp("fixed_expiry"));
              var offer =
                  new Offer(
                      r.getString("offer_id"),
                      recurring ? "subscription" : "one_time",
                      r.getString("plan"),
                      r.getString("period"),
                      new Amount(
                          BigDecimal.valueOf(r.getInt("amount_minor"), 2).toPlainString(), "RUB"),
                      r.getInt("checks_total"),
                      days,
                      fixed,
                      recurring,
                      recurring ? days : null,
                      recurring ? r.getString("consent_version") : null);
              return new Row(
                  id,
                  r.getObject("user_id", UUID.class),
                  offer,
                  r.getString("shop_id"),
                  r.getObject("provider_key", UUID.class),
                  r.getString("provider_id"),
                  r.getString("status"),
                  r.getString("confirmation_url"),
                  instant(r.getTimestamp("created_at")),
                  instant(r.getTimestamp("first_dispatch_at")),
                  r.getString("cancellation_reason"),
                  r.getObject("lease_token", UUID.class),
                  r.getString("provider_request"),
                  r.getObject("subscription_id", UUID.class),
                  r.getString("purpose"),
                  (Integer) r.getObject("sequence"));
            },
            id)
        .stream()
        .findFirst()
        .orElseThrow(ApiException::notFound);
  }

  private Sub sub(UUID id, boolean lock) {
    return db
        .query(
            "SELECT * FROM billing_test_subscriptions WHERE id=?" + (lock ? " FOR UPDATE" : ""),
            (r, n) ->
                new Sub(
                    id,
                    r.getObject("user_id", UUID.class),
                    r.getString("shop_id"),
                    r.getString("status"),
                    r.getBoolean("renewal_enabled"),
                    instant(r.getTimestamp("revoked_at")),
                    r.getInt("revision"),
                    r.getString("payment_method_id"),
                    instant(r.getTimestamp("next_due_at")),
                    r.getString("action_required"),
                    r.getBoolean("qa_early_used")),
            id)
        .stream()
        .findFirst()
        .orElseThrow(ApiException::notFound);
  }

  private Offer subscriptionOffer(UUID id) {
    UUID payment =
        db.queryForObject(
            "SELECT payment_id FROM billing_test_subscription_periods WHERE subscription_id=? AND"
                + " sequence=1",
            UUID.class,
            id);
    return row(payment, false).offer();
  }

  private Instant paidThrough(UUID id) {
    return instant(
        db.queryForObject(
            "SELECT max(e.expires_at) FROM billing_test_subscription_periods p JOIN"
                + " billing_test_entitlements e ON e.payment_id=p.payment_id WHERE"
                + " p.subscription_id=?",
            Timestamp.class,
            id));
  }

  public Subscription subscription(UUID user, UUID id) {
    permitted(user);
    var sub = sub(id, false);
    if (!sub.user().equals(user)) throw ApiException.notFound();
    var ids =
        db.query(
            "SELECT p.payment_id FROM billing_test_subscription_periods p JOIN"
                + " billing_test_entitlements e ON e.payment_id=p.payment_id WHERE"
                + " p.subscription_id=? AND e.starts_at<=? AND e.expires_at>?",
            (r, n) -> r.getObject(1, UUID.class),
            id,
            timestamp(clock.now()),
            timestamp(clock.now()));
    BillingDtos.Period period = null;
    if (!ids.isEmpty()) {
      var e = entitlements.forPayment(ids.getFirst());
      int seq = row(ids.getFirst(), false).sequence();
      period =
          new BillingDtos.Period(
              seq,
              e.startsAt(),
              e.expiresAt(),
              e.checksTotal(),
              e.checksUsed(),
              e.checksReserved(),
              e.checksRemaining());
    }
    var pending =
        db.query(
            "SELECT id,first_dispatch_at FROM billing_test_payments WHERE subscription_id=? AND"
                + " status NOT IN('succeeded','canceled') ORDER BY created_at DESC LIMIT 1",
            (r, n) -> new Object[] {r.getObject(1, UUID.class), r.getTimestamp(2)},
            id);
    UUID current = pending.isEmpty() ? null : (UUID) pending.getFirst()[0],
        inFlight = pending.isEmpty() || pending.getFirst()[1] == null ? null : current;
    return new Subscription(
        id,
        sub.status(),
        sub.enabled(),
        subscriptionOffer(id),
        period,
        sub.enabled() ? sub.due() : null,
        paidThrough(id),
        current,
        inFlight,
        sub.action());
  }

  public Subscription cancelSubscription(UUID user, UUID id) {
    permitted(user);
    tx.executeWithoutResult(
        t -> {
          lockUser(user);
          permitted(user);
          var current = sub(id, true);
          if (!current.user().equals(user)) throw ApiException.notFound();
          db.update(
              "UPDATE billing_test_subscriptions SET"
                  + " renewal_enabled=false,revoked_at=coalesce(revoked_at,?),status='canceled',next_due_at=NULL,revision=revision+1"
                  + " WHERE id=?",
              timestamp(clock.now()),
              id);
          // An operation never authorized for POST cannot exist remotely. Authorized operations
          // stay unresolved.
          db.update(
              "UPDATE billing_test_payments SET"
                  + " status='canceled',cancellation_reason='consent_revoked_before_dispatch' WHERE"
                  + " subscription_id=? AND status='creating' AND first_dispatch_at IS NULL",
              id);
        });
    return subscription(user, id);
  }

  /** Private operator entrypoint only; there is deliberately no HTTP mapping. */
  public Payment earlyQaRenewal(UUID id) {
    UUID payment = prepareRenewal(id, true);
    if (payment == null) throw ApiException.conflict("billing_purchase_unavailable");
    resume(payment);
    return get(sub(id, false).user(), payment);
  }

  UUID prepareRenewal(UUID id, boolean early) {
    var known = sub(id, false);
    permitted(known.user());
    return tx.execute(
        t -> {
          lockUser(known.user());
          permitted(known.user());
          var current = sub(id, true);
          Instant now = clock.now();
          if (!current.enabled()
              || current.revoked() != null
              || !current.status().equals("active")
              || !config.shopId.equals(current.shopId())) return null;
          if (pendingPayment(current.user()) != null) return null;
          if (early) {
            if (current.earlyUsed() || !now.isBefore(current.due())) return null;
          } else if (now.isBefore(current.due())) return null;
          int seq =
              db.queryForObject(
                  "SELECT coalesce(max(sequence),0)+1 FROM billing_test_subscription_periods WHERE"
                      + " subscription_id=?",
                  Integer.class,
                  id);
          UUID payment =
              insertPayment(
                  current.user(),
                  "renew-" + id + "-" + seq,
                  subscriptionOffer(id),
                  id,
                  "subscription_renewal",
                  current.method());
          if (early)
            db.update("UPDATE billing_test_subscriptions SET qa_early_used=true WHERE id=?", id);
          return payment;
        });
  }

  @Scheduled(fixedDelay = 15000)
  public void renewDue() {
    if (!config.enabled || !reconcilerEnabled) return;
    var ids =
        db.query(
            "SELECT id FROM billing_test_subscriptions WHERE renewal_enabled AND next_due_at<=?"
                + " ORDER BY next_due_at LIMIT 8",
            (r, n) -> r.getObject(1, UUID.class),
            timestamp(clock.now()));
    for (UUID id : ids)
      try {
        UUID payment = prepareRenewal(id, false);
        if (payment != null) reconcile(payment);
      } catch (Exception ignored) {
        /* Durable operation and bounded scheduler. */
      }
  }

  private Row claim(UUID id) {
    var known = row(id, false);
    return tx.execute(
        t -> {
          lockUser(known.user());
          permitted(known.user());
          Sub sub = known.subscriptionId() == null ? null : sub(known.subscriptionId(), true);
          var current = row(id, true);
          Instant now = clock.now();
          if (TERMINAL.contains(current.status())) return null;
          if (!config.shopId.equals(current.shopId())) {
            review(current);
            return null;
          }
          var times =
              db.queryForMap(
                  "SELECT lease_until,next_check_at FROM billing_test_payments WHERE id=?", id);
          if ((times.get("lease_until") != null
                  && ((Timestamp) times.get("lease_until")).toInstant().isAfter(now))
              || ((Timestamp) times.get("next_check_at")).toInstant().isAfter(now)) return null;
          boolean post = current.providerId() == null;
          if (post) {
            if (current.status().equals("review_required")) return null;
            if (sub != null
                && (sub.revoked() != null
                    || (!current.purpose().equals("subscription_initial") && !sub.enabled()))) {
              review(current);
              return null;
            }
            if (current.firstDispatch() != null
                && !now.isBefore(current.firstDispatch().plus(Duration.ofHours(23)))) {
              review(current);
              return null;
            }
          }
          UUID fence = UUID.randomUUID();
          db.update(
              "UPDATE billing_test_payments SET"
                  + " lease_until=?,lease_token=?,next_check_at=?,updated_at=? WHERE id=?",
              timestamp(now.plusSeconds(45)),
              fence,
              timestamp(now.plusSeconds(5)),
              timestamp(now),
              id);
          if (post) {
            // This committed authorization is the cancellation linearization point for THIS HTTP
            // attempt.
            // A later cancel reports it in flight and forbids every subsequent POST
            // authorization/retry.
            db.update(
                "UPDATE billing_test_payments SET"
                    + " first_dispatch_at=coalesce(first_dispatch_at,?),post_authorized_at=?,authorized_revision=?,post_attempts=post_attempts+1"
                    + " WHERE id=? AND lease_token=?",
                timestamp(now),
                timestamp(now),
                sub == null ? null : sub.revision(),
                id,
                fence);
          }
          return row(id, false);
        });
  }

  void reconcile(UUID id) {
    Row claimed = claim(id);
    if (claimed == null) return;
    try {
      JsonNode remote =
          claimed.providerId() == null
              ? gateway.create(claimed.providerKey(), claimed.providerRequest())
              : gateway.get(claimed.providerId());
      validate(claimed, remote);
      if (claimed.providerId() == null) {
        String providerId = remote.path("id").asText();
        tx.executeWithoutResult(
            t -> {
              lockUser(claimed.user());
              if (claimed.subscriptionId() != null) sub(claimed.subscriptionId(), true);
              var current = row(id, true);
              if (!Objects.equals(current.leaseToken(), claimed.leaseToken())) return;
              if (current.providerId() != null && !current.providerId().equals(providerId))
                throw YooKassaTestGateway.invalid();
              db.update(
                  "UPDATE billing_test_payments SET provider_id=? WHERE id=?", providerId, id);
            });
        remote = gateway.get(providerId);
        validate(claimed, remote);
        if (!providerId.equals(remote.path("id").asText())) throw YooKassaTestGateway.invalid();
      }
      apply(claimed, remote);
    } catch (ApiException e) {
      if (e.code().equals("billing_verification_failed"))
        tx.executeWithoutResult(
            t -> {
              lockUser(claimed.user());
              if (claimed.subscriptionId() != null) sub(claimed.subscriptionId(), true);
              var current = row(id, true);
              if (Objects.equals(current.leaseToken(), claimed.leaseToken())) review(current);
            });
      throw e;
    } finally {
      db.update(
          "UPDATE billing_test_payments SET"
              + " lease_until=NULL,lease_token=NULL,next_check_at=?,updated_at=? WHERE id=? AND"
              + " lease_token=?",
          timestamp(clock.now().plusSeconds(5)),
          timestamp(clock.now()),
          id,
          claimed.leaseToken());
    }
  }

  private void validate(Row row, JsonNode remote) {
    String id = remote.path("id").asText(), status = remote.path("status").asText();
    if (!id.matches("[a-zA-Z0-9-]{1,64}")
        || (row.providerId() != null && !row.providerId().equals(id))
        || !remote.path("test").isBoolean()
        || !remote.path("test").asBoolean()
        || !Set.of("pending", "waiting_for_capture", "succeeded", "canceled").contains(status)
        || !remote.path("paid").isBoolean()
        || ("succeeded".equals(status) && !remote.path("paid").asBoolean())
        || !row.shopId().equals(remote.path("recipient").path("account_id").asText())
        || !row.id().toString().equals(remote.path("metadata").path("botai_order_id").asText())
        || !"RUB".equals(remote.path("amount").path("currency").asText()))
      throw YooKassaTestGateway.invalid();
    try {
      String value = remote.path("amount").path("value").asText();
      if (!value.matches("[0-9]+\\.[0-9]{2}")
          || new BigDecimal(value).compareTo(new BigDecimal(row.offer().amount().value())) != 0)
        throw YooKassaTestGateway.invalid();
    } catch (NumberFormatException e) {
      throw YooKassaTestGateway.invalid();
    }
    if (remote.has("confirmation") && remote.path("confirmation").has("confirmation_url"))
      confirmationUrl(remote.path("confirmation").path("confirmation_url").asText());
    if (row.purpose().equals("subscription_renewal") && status.equals("succeeded")) {
      String requested = json.read(row.providerRequest()).path("payment_method_id").asText();
      if (!requested.equals(remote.path("payment_method").path("id").asText()))
        throw YooKassaTestGateway.invalid();
    }
  }

  static String confirmationUrl(String value) {
    try {
      URI uri = URI.create(value);
      if (value.length() > 2048
          || !"https".equals(uri.getScheme())
          || !Set.of("yoomoney.ru", "yookassa.ru").contains(uri.getHost())
          || uri.getUserInfo() != null
          || (uri.getPort() != -1 && uri.getPort() != 443)) throw YooKassaTestGateway.invalid();
      return value;
    } catch (IllegalArgumentException e) {
      throw YooKassaTestGateway.invalid();
    }
  }

  private void apply(Row claimed, JsonNode remote) {
    tx.executeWithoutResult(
        t -> {
          lockUser(claimed.user());
          permitted(claimed.user());
          Sub sub = claimed.subscriptionId() == null ? null : sub(claimed.subscriptionId(), true);
          Row current = row(claimed.id(), true);
          if (!Objects.equals(current.leaseToken(), claimed.leaseToken())) return;
          validate(current, remote);
          if (TERMINAL.contains(current.status())) return;
          String status = remote.path("status").asText();
          Instant now = clock.now();
          if (status.equals("succeeded")) {
            Instant start = now;
            if (sub != null) {
              Instant previous = paidThrough(sub.id());
              if (previous != null && previous.isAfter(start)) start = previous;
            }
            Instant expiry =
                current.offer().expiresAt() == null
                    ? start.plus(Duration.ofDays(current.offer().durationDays()))
                    : current.offer().expiresAt();
            if (!expiry.isAfter(start)
                || (sub == null && entitlements.active(current.user()) != null)) {
              review(current);
              return;
            }
            db.update(
                "INSERT INTO"
                    + " billing_test_entitlements(payment_id,user_id,plan,starts_at,expires_at,checks_total)"
                    + " VALUES(?,?,?,?,?,?) ON CONFLICT(payment_id) DO NOTHING",
                current.id(),
                current.user(),
                current.offer().plan(),
                timestamp(start),
                timestamp(expiry),
                current.offer().checkLimit());
            if (sub != null) {
              String method = sub.method(), action = null;
              if (current.purpose().equals("subscription_initial")) {
                var pm = remote.path("payment_method");
                String value = pm.path("id").asText();
                method =
                    pm.path("saved").isBoolean()
                            && pm.path("saved").asBoolean()
                            && value.matches("[a-zA-Z0-9-]{1,64}")
                        ? value
                        : null;
                if (method == null) action = "payment_method_required";
              }
              boolean auto = sub.revoked() == null && method != null;
              db.update(
                  "UPDATE billing_test_subscriptions SET"
                      + " status=?,payment_method_id=?,renewal_enabled=?,next_due_at=?,action_required=?"
                      + " WHERE id=?",
                  sub.revoked() == null ? "active" : "canceled",
                  method,
                  auto,
                  auto ? timestamp(expiry) : null,
                  action,
                  sub.id());
            }
          } else if (status.equals("canceled") && sub != null) {
            db.update(
                "UPDATE billing_test_subscriptions SET"
                    + " status=?,renewal_enabled=false,next_due_at=NULL,action_required='payment_failed'"
                    + " WHERE id=?",
                sub.revoked() == null ? "payment_failed" : "canceled",
                sub.id());
          }
          String url =
              remote.path("confirmation").path("confirmation_url").isString()
                  ? confirmationUrl(remote.path("confirmation").path("confirmation_url").asText())
                  : null;
          db.update(
              "UPDATE billing_test_payments SET"
                  + " status=?,confirmation_url=?,cancellation_reason=?,updated_at=? WHERE id=?",
              status,
              Set.of("pending", "waiting_for_capture").contains(status) ? url : null,
              status.equals("canceled") ? "payment_canceled" : null,
              timestamp(now),
              current.id());
        });
  }

  private void review(Row row) {
    db.update(
        "UPDATE billing_test_payments SET"
            + " status='review_required',confirmation_url=NULL,updated_at=? WHERE id=? AND status"
            + " NOT IN('succeeded','canceled')",
        timestamp(clock.now()),
        row.id());
    if (row.subscriptionId() != null)
      db.update(
          "UPDATE billing_test_subscriptions SET status=CASE WHEN revoked_at IS NULL THEN"
              + " 'review_required' ELSE 'canceled'"
              + " END,renewal_enabled=false,next_due_at=NULL,action_required='review_required'"
              + " WHERE id=?",
          row.subscriptionId());
  }

  public void webhook(JsonNode notification) {
    if (!config.enabled
        || !"notification".equals(notification.path("type").asText())
        || !Set.of("payment.succeeded", "payment.canceled", "payment.waiting_for_capture")
            .contains(notification.path("event").asText())) return;
    String providerId = notification.path("object").path("id").asText();
    if (!providerId.matches("[a-zA-Z0-9-]{1,64}")) return;
    var ids =
        db.query(
            "SELECT id FROM billing_test_payments WHERE provider_id=?",
            (r, n) -> r.getObject(1, UUID.class),
            providerId);
    UUID localId;
    Row callbackClaim = null;
    if (ids.isEmpty()) {
      try {
        String locator =
            notification.path("object").path("metadata").path("botai_order_id").asText();
        localId = UUID.fromString(locator);
        if (!localId.toString().equalsIgnoreCase(locator)) return;
      } catch (IllegalArgumentException invalidLocator) {
        return;
      }
      try {
        callbackClaim = claimCallback(localId);
      } catch (ApiException retryableClaim) {
        if (retryableClaim.code().equals("billing_provider_unavailable"))
          auditCallback(localId, notification.path("event").asText(), retryableClaim.status());
        throw retryableClaim;
      }
      if (callbackClaim == null) return;
    } else {
      localId = ids.getFirst();
      var locator = notification.path("object").path("metadata").path("botai_order_id");
      if (!locator.isMissingNode() && !localId.toString().equals(locator.asText())) return;
    }
    int outcome = 200;
    try {
      if (callbackClaim == null) reconcile(localId);
      else recoverCallback(callbackClaim, providerId);
    } catch (ApiException failure) {
      outcome = failure.status();
      throw failure;
    } catch (RuntimeException failure) {
      outcome = 500;
      throw failure;
    } finally {
      auditCallback(localId, notification.path("event").asText(), outcome);
    }
  }

  private void auditCallback(UUID localId, String event, int outcome) {
    LOG.info(
        "billing_test_webhook route=/api/billing/yookassa/test/webhook requestId={} paymentId={}"
            + " event={} status={}",
        RequestIds.current(),
        localId,
        event,
        outcome);
  }

  private Row claimCallback(UUID id) {
    var users =
        db.query(
            "SELECT user_id FROM billing_test_payments WHERE id=?",
            (r, n) -> r.getObject(1, UUID.class),
            id);
    if (users.isEmpty() || !entitlements.allowed(users.getFirst())) return null;
    return tx.execute(
        t -> {
          UUID user = users.getFirst();
          lockUser(user);
          if (!entitlements.allowed(user)) return null;
          var known = row(id, false);
          if (known.subscriptionId() != null) {
            var subscription = sub(known.subscriptionId(), true);
            if (!subscription.user().equals(user) || !config.shopId.equals(subscription.shopId()))
              return null;
          }
          var current = row(id, true);
          if (current.providerId() != null
              || current.firstDispatch() == null
              || TERMINAL.contains(current.status())
              || !config.shopId.equals(current.shopId())) return null;
          Instant now = clock.now();
          var times =
              db.queryForMap(
                  "SELECT lease_until,next_check_at FROM billing_test_payments WHERE id=?", id);
          if ((times.get("lease_until") != null
                  && ((Timestamp) times.get("lease_until")).toInstant().isAfter(now))
              || ((Timestamp) times.get("next_check_at")).toInstant().isAfter(now)) {
            // Do not ACK and lose the only provider-ID locator after the POST replay window.
            throw YooKassaTestGateway.unavailable();
          }
          db.update(
              "UPDATE billing_test_payments SET lease_until=?,lease_token=?,next_check_at=? WHERE"
                  + " id=?",
              timestamp(now.plusSeconds(45)),
              UUID.randomUUID(),
              timestamp(now.plusSeconds(5)),
              id);
          return row(id, false);
        });
  }

  private void recoverCallback(Row claimed, String candidateId) {
    try {
      // An untrusted callback is only a locator. This path MUST NOT select/retry a POST.
      JsonNode remote = gateway.get(candidateId);
      if (!candidateId.equals(remote.path("id").asText())) throw YooKassaTestGateway.invalid();
      validate(claimed, remote);
      boolean acknowledged =
          tx.execute(
              t -> {
                lockUser(claimed.user());
                permitted(claimed.user());
                if (claimed.subscriptionId() != null) sub(claimed.subscriptionId(), true);
                var current = row(claimed.id(), true);
                if (!Objects.equals(current.leaseToken(), claimed.leaseToken())
                    || TERMINAL.contains(current.status()))
                  return candidateId.equals(current.providerId());
                if (current.providerId() != null && !current.providerId().equals(candidateId))
                  return false;
                validate(current, remote);
                db.update(
                    "UPDATE billing_test_payments SET provider_id=? WHERE id=?",
                    candidateId,
                    current.id());
                // Joins this transaction: validated binding, paid grant and status commit
                // atomically.
                apply(claimed, remote);
                return true;
              });
      if (!acknowledged) throw YooKassaTestGateway.unavailable();
    } finally {
      db.update(
          "UPDATE billing_test_payments SET lease_until=NULL,lease_token=NULL,next_check_at=? WHERE"
              + " id=? AND lease_token=?",
          timestamp(clock.now().plusSeconds(5)),
          claimed.id(),
          claimed.leaseToken());
    }
  }

  @Scheduled(fixedDelay = 15000)
  public void reconcilePending() {
    if (!config.enabled || !reconcilerEnabled) return;
    var ids =
        db.query(
            "SELECT id FROM billing_test_payments WHERE (status"
                + " IN('creating','pending','waiting_for_capture') OR (status='review_required' AND"
                + " provider_id IS NOT NULL)) AND next_check_at<=? AND (lease_until IS NULL OR"
                + " lease_until<=?) ORDER BY next_check_at LIMIT 8",
            (r, n) -> r.getObject(1, UUID.class),
            timestamp(clock.now()),
            timestamp(clock.now()));
    for (UUID id : ids)
      try {
        reconcile(id);
      } catch (Exception ignored) {
        /* Never log provider content. */
      }
  }

  private static Instant instant(Timestamp time) {
    return time == null ? null : time.toInstant();
  }

  private static Timestamp timestamp(Instant time) {
    return time == null ? null : Timestamp.from(time);
  }
}
