package org.botai.back.billing;

import static org.assertj.core.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class SandboxMigrationTest {
  @Container
  static PostgreSQLContainer postgres =
      new PostgreSQLContainer("postgres:17").withDatabaseName("fresh_payments_test");

  @Test
  void initializesOnlyExplicitEmptySandboxAndNeverRunsApplication() throws Exception {
    var env = new HashMap<String, String>();
    env.put("APP_MIGRATION_JDBC_URL", postgres.getJdbcUrl().split("\\?", 2)[0]);
    env.put("APP_MIGRATION_USER", postgres.getUsername());
    env.put("APP_MIGRATION_PASSWORD", postgres.getPassword());
    assertThat(run(env)).isEqualTo("2:SANDBOX_MIGRATION_FAILED configuration\n");
    env.put("APP_BILLING_INITIALIZE_EMPTY_SANDBOX", "yes");
    assertThat(run(env)).isEqualTo("0:SANDBOX_MIGRATION_OK after=21\n");
    assertThat(run(env)).isEqualTo("1:SANDBOX_MIGRATION_FAILED database_or_validation\n");
    try (var c =
            DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        var q =
            c.createStatement()
                .executeQuery("SELECT count(*) FROM flyway_schema_history WHERE success")) {
      q.next();
      assertThat(q.getInt(1)).isEqualTo(21);
    }
    env.put("APP_MIGRATION_JDBC_URL", "jdbc:postgresql://host/production");
    assertThat(run(env)).isEqualTo("2:SANDBOX_MIGRATION_FAILED configuration\n");
  }

  @Test
  void v12UpgradePreservesBillingStateAndExistingUser() throws Exception {
    try (var c =
        DriverManager.getConnection(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())) {
      c.createStatement().executeUpdate("CREATE DATABASE upgrade_payments_test");
    }
    String url = postgres.getJdbcUrl().replace("/fresh_payments_test", "/upgrade_payments_test");
    var old =
        org.flywaydb.core.Flyway.configure()
            .dataSource(url, postgres.getUsername(), postgres.getPassword())
            .target("12")
            .load();
    old.migrate();
    UUID user = UUID.randomUUID();
    int checksum;
    try (var c = DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword());
        var p =
            c.prepareStatement(
                "INSERT INTO users(id,email,password_hash,email_verified,plan_id)"
                    + " VALUES(?,'upgrade@example.test','unchanged',true,'pro')")) {
      p.setObject(1, user);
      p.executeUpdate();
      try (var q =
          c.createStatement()
              .executeQuery("SELECT checksum FROM flyway_schema_history WHERE version='12'")) {
        q.next();
        checksum = q.getInt(1);
      }
    }
    var latest =
        org.flywaydb.core.Flyway.configure()
            .dataSource(url, postgres.getUsername(), postgres.getPassword())
            .load();
    assertThat(latest.migrate().migrationsExecuted).isEqualTo(9);
    latest.validate();
    try (var c = DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword());
        var q =
            c.createStatement()
                .executeQuery(
                    "SELECT password_hash,email_verified,plan_id,(SELECT checksum FROM"
                        + " flyway_schema_history WHERE version='12'),(SELECT count(*) FROM"
                        + " billing_test_entitlements) FROM users WHERE"
                        + " email='upgrade@example.test'")) {
      assertThat(q.next()).isTrue();
      assertThat(q.getString(1)).isEqualTo("unchanged");
      assertThat(q.getBoolean(2)).isTrue();
      assertThat(q.getString(3)).isEqualTo("pro");
      assertThat(q.getInt(4)).isEqualTo(checksum);
      assertThat(q.getInt(5)).isZero();
    }
  }

  @Test
  void v13ImmutableSnapshotAndConservativeSettlementBackfill() throws Exception {
    try (var c =
        DriverManager.getConnection(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())) {
      c.createStatement().executeUpdate("CREATE DATABASE v13_payments_test");
    }
    String url = postgres.getJdbcUrl().replace("/fresh_payments_test", "/v13_payments_test");
    var old =
        org.flywaydb.core.Flyway.configure()
            .dataSource(url, postgres.getUsername(), postgres.getPassword())
            .target("13")
            .load();
    old.migrate();
    var db =
        new org.springframework.jdbc.core.JdbcTemplate(
            new org.springframework.jdbc.datasource.DriverManagerDataSource(
                url, postgres.getUsername(), postgres.getPassword()));
    UUID user = UUID.randomUUID(), payment = UUID.randomUUID();
    db.update(
        "INSERT INTO users(id,email,password_hash,email_verified,plan_id)"
            + " VALUES(?,'v13@example.test','unchanged',true,'pro')",
        user);
    db.update(
        "INSERT INTO"
            + " billing_test_payments(id,user_id,idempotency_key,offer_id,plan,period,amount_minor,checks_total,duration_days,return_url,shop_id,provider_key,provider_request,status)"
            + " VALUES(?,?,'legacy','light-month-v1','light','month',29900,30,30,'http://localhost:13002/billing/return','12345',?,'{\"capture\":true}',"
            + " 'succeeded')",
        payment,
        user,
        UUID.randomUUID());
    db.update(
        "INSERT INTO"
            + " billing_test_entitlements(payment_id,user_id,plan,starts_at,expires_at,checks_total)"
            + " VALUES(?,?,'light',now(),now()+interval '30 days',30)",
        payment,
        user);
    var ids = new java.util.ArrayList<UUID>();
    for (int n = 0; n < 4; n++) {
      UUID id = UUID.randomUUID();
      ids.add(id);
      String state = n == 0 ? "graded" : n == 3 ? "running" : "failed";
      db.update(
          "INSERT INTO"
              + " grading_submissions(id,user_id,requested_attempt_id,requested_item_id,input_revision,idempotency_key,request_hash,request_id,status)"
              + " VALUES(?,?,?,?,0,?,'hash',?,?)",
          id,
          user,
          UUID.randomUUID(),
          UUID.randomUUID(),
          id.toString(),
          UUID.randomUUID(),
          state);
      db.update(
          "INSERT INTO grading_jobs(submission_id,state,lease_until) VALUES(?,?,CASE WHEN ? THEN"
              + " now()+interval '1 minute' ELSE NULL END)",
          id,
          n == 3 ? "dispatching" : "done",
          n == 3);
      db.update(
          "INSERT INTO grading_runs(id,submission_id,fencing_token,package_id,outcome,finished_at)"
              + " VALUES(?,?,1,'fixture',?,CASE WHEN ? THEN now() ELSE NULL END)",
          UUID.randomUUID(),
          id,
          n < 2 ? state : null,
          n < 2);
      db.update(
          "INSERT INTO billing_test_usage(submission_id,payment_id) VALUES(?,?)", id, payment);
      if (n == 0)
        db.update(
            "INSERT INTO grading_results(submission_id,is_graded,score,max_score,is_demo)"
                + " VALUES(?,true,0,2,true)",
            id);
    }
    String before =
        db.queryForObject(
            "SELECT row_to_json(p)::text FROM billing_test_payments p WHERE id=?",
            String.class,
            payment);
    String grants =
        db.queryForObject(
            "SELECT jsonb_agg(to_jsonb(e) ORDER BY payment_id)::text FROM billing_test_entitlements"
                + " e",
            String.class);
    String usage =
        db.queryForObject(
            "SELECT jsonb_agg(to_jsonb(u) ORDER BY submission_id)::text FROM billing_test_usage u",
            String.class);
    var checksums =
        db.queryForList(
            "SELECT version,checksum FROM flyway_schema_history ORDER BY installed_rank");
    var latest =
        org.flywaydb.core.Flyway.configure()
            .dataSource(url, postgres.getUsername(), postgres.getPassword())
            .load();
    assertThat(latest.migrate().migrationsExecuted).isEqualTo(8);
    latest.validate();
    assertThat(
            db.queryForObject(
                "SELECT"
                    + " (to_jsonb(p)-ARRAY['subscription_id','purpose','post_authorized_at','authorized_revision','post_attempts'])=?::jsonb"
                    + " FROM billing_test_payments p WHERE id=?",
                Boolean.class,
                before,
                payment))
        .isTrue();
    assertThat(
            db.queryForObject(
                "SELECT jsonb_agg(to_jsonb(e) ORDER BY payment_id)::text FROM"
                    + " billing_test_entitlements e",
                String.class))
        .isEqualTo(grants);
    assertThat(
            db.queryForObject(
                "SELECT jsonb_agg(to_jsonb(u) ORDER BY submission_id)::text FROM billing_test_usage"
                    + " u",
                String.class))
        .isEqualTo(usage);
    assertThat(
            db.queryForList(
                "SELECT version,checksum FROM flyway_schema_history WHERE version::integer<=13 ORDER BY"
                    + " installed_rank"))
        .isEqualTo(checksums);
    assertThat(
            db.queryForObject(
                "SELECT provider_request FROM billing_test_payments WHERE id=?",
                String.class,
                payment))
        .isEqualTo("{\"capture\":true}");
    assertThat(
            db.queryForObject(
                "SELECT purpose FROM billing_test_payments WHERE id=?", String.class, payment))
        .isEqualTo("one_time");
    assertThat(db.queryForObject("SELECT plan_id FROM users WHERE id=?", String.class, user))
        .isEqualTo("pro");
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_usage", Integer.class))
        .isEqualTo(4);
    assertThat(
            db.queryForObject(
                "SELECT outcome FROM billing_test_usage_settlements WHERE submission_id=?",
                String.class,
                ids.get(0)))
        .isEqualTo("consume");
    assertThat(
            db.queryForObject(
                "SELECT outcome FROM billing_test_usage_settlements WHERE submission_id=?",
                String.class,
                ids.get(1)))
        .isEqualTo("release");
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_usage_settlements WHERE submission_id IN(?,?)",
                Integer.class,
                ids.get(2),
                ids.get(3)))
        .isZero();
    assertThatThrownBy(
            () ->
                db.update(
                    "UPDATE billing_test_usage_settlements SET outcome='release' WHERE"
                        + " submission_id=?",
                    ids.get(0)))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
  }

  String run(Map<String, String> env) throws Exception {
    var builder =
        new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dloader.main=org.botai.back.migration.SandboxMigrateOnly",
                "-cp",
                System.getProperty("botai.migration.jar"),
                "org.springframework.boot.loader.launch.PropertiesLauncher")
            .redirectErrorStream(true);
    builder.environment().clear();
    builder.environment().putAll(env);
    var child = builder.start();
    try {
      assertThat(child.waitFor(60, TimeUnit.SECONDS)).isTrue();
      return child.exitValue()
          + ":"
          + new String(child.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    } finally {
      if (child.isAlive()) child.destroyForcibly();
    }
  }
}
