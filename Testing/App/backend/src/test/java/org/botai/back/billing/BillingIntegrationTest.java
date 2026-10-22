package org.botai.back.billing;

import static org.assertj.core.api.Assertions.*;
import static org.botai.back.billing.BillingDtos.*;

import java.awt.image.BufferedImage;
import java.io.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.botai.back.attempt.*;
import org.botai.back.catalog.*;
import org.botai.back.common.*;
import org.botai.back.grading.*;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.media.*;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.profile.ProfileService;
import org.botai.back.user.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.*;

@org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "spring.docker.compose.enabled=false", "management.server.port=0",
          "app.grading.worker-enabled=false", "app.billing.reconciler-enabled=false",
      "app.billing.mode=test", "app.billing.sandbox-database=botai_payments_test",
          "app.billing.shop-id=12345", "app.billing.secret-key=test_fixture_only",
      "app.billing.return-origin=http://localhost:13002",
          "app.billing.test-accounts=billing@example.test,other@example.test"
    })
@Testcontainers
class BillingIntegrationTest {
  @Container @ServiceConnection
  static PostgreSQLContainer postgres =
      new PostgreSQLContainer("postgres:17").withDatabaseName("botai_payments_test");

  @TestConfiguration
  static class Ports {
    @Bean
    @Primary
    TestClock testClock() {
      return new TestClock();
    }

    @Bean
    @Primary
    TestGateway testGateway(JsonCodec json) {
      return new TestGateway(json);
    }

    @Bean
    @Primary
    TestAi testAi() {
      return new TestAi();
    }

    @Bean
    @Primary
    TestStorage testStorage() {
      return new TestStorage();
    }
  }

  static class TestClock extends BillingClock {
    volatile Instant now = Instant.now();

    public Instant now() {
      return now;
    }

    void advance(Duration d) {
      now = now.plus(d);
    }
  }

  static class TestGateway implements BillingGateway {
    final JsonCodec json;
    final Map<UUID, JsonNode> payments = new ConcurrentHashMap<>();
    final Map<UUID, String> payloads = new ConcurrentHashMap<>();
    final AtomicInteger creates = new AtomicInteger(), gets = new AtomicInteger();
    volatile boolean failAfterCreate, failGet, wrongAmount, live, saved = true;
    volatile Runnable earlyWebhook;

    record Gate(CountDownLatch entered, CountDownLatch release) {}

    final java.util.concurrent.atomic.AtomicReference<Gate> createGate =
        new java.util.concurrent.atomic.AtomicReference<>();
    final java.util.concurrent.atomic.AtomicReference<Gate> nextGate =
        new java.util.concurrent.atomic.AtomicReference<>();

    TestGateway(JsonCodec json) {
      this.json = json;
    }

    public JsonNode create(UUID key, String body) {
      assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
      creates.incrementAndGet();
      var gate = createGate.getAndSet(null);
      if (gate != null) {
        gate.entered.countDown();
        try {
          assertThat(gate.release.await(10, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
          throw new RuntimeException(e);
        }
      }
      var request = json.read(body);
      String old = payloads.putIfAbsent(key, body);
      if (old != null) assertThat(body).isEqualTo(old);
      var remote =
          payments.computeIfAbsent(
              key,
              k ->
                  json.read(
                      json.write(
                          Map.of(
                              "id",
                              UUID.randomUUID().toString(),
                              "status",
                              "pending",
                              "paid",
                              false,
                              "test",
                              true,
                              "amount",
                              request.path("amount"),
                              "metadata",
                              request.path("metadata"),
                              "recipient",
                              Map.of("account_id", "12345"),
                              "confirmation",
                              Map.of("confirmation_url", "https://yoomoney.ru/checkout/test")))));
      if (request.path("save_payment_method").asBoolean() || request.has("payment_method_id"))
        ((tools.jackson.databind.node.ObjectNode) remote)
            .set(
                "payment_method",
                json.read(
                    json.write(
                        Map.of(
                            "id",
                            request.has("payment_method_id")
                                ? request.path("payment_method_id").asText()
                                : "saved-test-method",
                            "saved",
                            saved))));
      if (earlyWebhook != null) {
        try {
          earlyWebhook.run();
        } catch (ApiException notificationNotAcknowledged) {
          // Provider creation does not depend on delivery of its separate callback.
        }
      }
      if (failAfterCreate) throw YooKassaTestGateway.unavailable();
      return decorated(remote);
    }

    public JsonNode get(String id) {
      assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
      gets.incrementAndGet();
      if (failGet) throw YooKassaTestGateway.unavailable();
      var snapshot =
          decorated(
              payments.values().stream()
                  .filter(p -> p.path("id").asText().equals(id))
                  .findFirst()
                  .orElseThrow());
      var gate = nextGate.getAndSet(null);
      if (gate != null) {
        gate.entered.countDown();
        try {
          assertThat(gate.release.await(10, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
          throw new RuntimeException(e);
        }
      }
      return snapshot;
    }

    JsonNode decorated(JsonNode n) {
      var copy = (tools.jackson.databind.node.ObjectNode) json.read(n.toString());
      if (wrongAmount) copy.set("amount", json.read("{\"value\":\"1.00\",\"currency\":\"RUB\"}"));
      if (live) copy.put("test", false);
      return copy;
    }

    void state(String status) {
      payments
          .values()
          .forEach(
              n -> {
                var o = (tools.jackson.databind.node.ObjectNode) n;
                o.put("status", status);
                o.put("paid", status.equals("succeeded") || status.equals("waiting_for_capture"));
              });
    }
  }

  static class TestAi implements GradingGateway {
    volatile String mode = "mock";

    public Map<Integer, Capability> capabilities() {
      var map = new HashMap<Integer, Capability>();
      int[] maxima = {2, 3, 2, 2, 3, 4, 4};
      for (int n = 14; n <= 20; n++)
        map.put(n, new Capability(n, maxima[n - 14], n == 16, n == 16 ? "fixture" : null, mode));
      return map;
    }

    public Response grade(UUID run, TaskSnapshot task, List<Image> images, String pinned) {
      throw new IllegalStateException("Simulated provider failure");
    }
  }

  static class TestStorage implements ObjectStorage {
    final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    public void put(String k, byte[] b, String mime) {
      objects.put(k, b);
    }

    public byte[] get(String k, long cap) {
      return objects.get(k);
    }

    public void delete(String k) {
      objects.remove(k);
    }

    public String bucket() {
      return "sandbox";
    }
  }

  @Autowired BillingService billing;
  @Autowired BillingEntitlements entitlements;
  @Autowired BillingConfig config;
  @Autowired TestClock clock;
  @Autowired TestGateway gateway;
  @Autowired TestAi ai;
  @Autowired JdbcTemplate db;
  @Autowired JsonCodec json;
  @Autowired UserRepository users;
  @Autowired ProfileService profiles;
  @Autowired AttemptService attempts;
  @Autowired SubmissionService submissions;
  @Autowired MediaService media;
  @Autowired GradingWorker worker;
  @Autowired CatalogService catalog;
  @Autowired org.springframework.transaction.support.TransactionTemplate tx;
  @Autowired org.springframework.boot.resttestclient.TestRestTemplate rest;
  @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
  UUID user, other;

  @BeforeEach
  void setup() {
    db.execute("TRUNCATE billing_test_usage_settlements");
    db.update("DELETE FROM billing_test_usage");
    db.update("DELETE FROM billing_test_entitlements");
    db.update("DELETE FROM billing_test_subscription_periods");
    db.update("DELETE FROM billing_test_payments");
    db.update("DELETE FROM billing_test_subscriptions");
    gateway.payments.clear();
    gateway.payloads.clear();
    gateway.creates.set(0);
    gateway.gets.set(0);
    gateway.failAfterCreate = false;
    gateway.failGet = false;
    gateway.wrongAmount = false;
    gateway.live = false;
    gateway.earlyWebhook = null;
    gateway.nextGate.set(null);
    gateway.createGate.set(null);
    gateway.saved = true;
    ai.mode = "mock";
    clock.now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
    user = account("billing@example.test");
    other = account("other@example.test");
    db.update("UPDATE grading_jobs SET state='done'");
    db.update("DELETE FROM rate_limit_windows");
  }

  UUID account(String email) {
    var u =
        users
            .findByEmail(email)
            .orElseGet(
                () ->
                    users.save(
                        User.builder()
                            .email(email)
                            .passwordHash(passwords.encode("test-secure-password"))
                            .build()));
    db.update(
        "UPDATE users SET email_verified=true,plan_id='free',enabled=true WHERE id=?", u.getId());
    return u.getId();
  }

  Payment create() {
    return billing.create(user, UUID.randomUUID().toString(), new Create("light-season-v1"));
  }

  Payment paid() {
    var p = create();
    gateway.state("succeeded");
    clock.advance(Duration.ofSeconds(6));
    return billing.refresh(user, p.id());
  }

  UUID submission(int number) throws Exception {
    var attempt =
        attempts.startTraining(
            user,
            UUID.randomUUID().toString(),
            new AttemptDtos.TrainingRequest(
                CatalogRepository.FORMAT,
                List.of(new AttemptDtos.Selection(number, null, 1)),
                null,
                "catalog",
                null));
    UUID id =
        UUID.fromString(
            submissions
                .create(
                    user,
                    UUID.randomUUID().toString(),
                    new SubmissionService.Intent(
                        attempt.id(), attempt.items().getFirst().id(), 0, null))
                .path("id")
                .asText());
    var out = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB), "png", out);
    media.upload(
        user, id, new MockMultipartFile("file", "solution.png", "image/png", out.toByteArray()));
    return id;
  }

  void problem(Runnable action, String code) {
    assertThatThrownBy(action::run)
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo(code);
  }

  @Test
  void pendingSuccessDuplicateQuotaAndExpiryLifecycle() throws Exception {
    var pending = create();
    assertThat(pending.status()).isEqualTo("pending");
    assertThat(pending.entitlementApplied()).isFalse();
    assertThat(entitlements.active(user)).isNull();
    assertThat(profiles.get(user).features()).isEmpty();
    gateway.state("succeeded");
    clock.advance(Duration.ofSeconds(6));
    var success = billing.refresh(user, pending.id());
    assertThat(success.entitlementApplied()).isTrue();
    assertThat(success.status()).isEqualTo("succeeded");
    assertThat(profiles.get(user).plan()).isEqualTo("free");
    assertThat(profiles.get(user).features()).contains("aiReview");
    clock.advance(Duration.ofSeconds(6));
    billing.refresh(user, pending.id());
    billing.webhook(
        json.read(
            "{\"type\":\"notification\",\"event\":\"payment.succeeded\",\"object\":{\"id\":\""
                + gateway.payments.values().iterator().next().path("id").asText()
                + "\"}}"));
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_entitlements", Integer.class))
        .isEqualTo(1);
    UUID submission = submission(16);
    submissions.finalizeSubmission(user, submission, 1);
    submissions.finalizeSubmission(user, submission, 1);
    assertThat(billing.status(user).entitlement().checksReserved()).isEqualTo(1);
    worker.execute(worker.claim());
    assertThat(billing.status(user).entitlement().checksUsed()).isZero();
    assertThat(billing.status(user).entitlement().checksReserved()).isZero();
    var disabled = new BillingConfig("disabled", "", "", "", "", "", db);
    assertThat(new BillingEntitlements(db, disabled, clock).active(user)).isNull();
    clock.now = BillingOffers.SEASON_END.plusSeconds(1);
    assertThat(billing.status(user).entitlement()).isNull();
    assertThat(profiles.get(user).features()).isEmpty();
    UUID afterExpiry = submission(16);
    problem(() -> submissions.finalizeSubmission(user, afterExpiry, 1), "ai_review_required");
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_usage", Integer.class))
        .isEqualTo(1);
  }

  @Test
  void sameKeyConcurrentAndUnknownCreateRecoverWithoutSecondProviderPayment() throws Exception {
    gateway.failAfterCreate = true;
    String key = UUID.randomUUID().toString();
    var first = billing.create(user, key, new Create("core-season-v1"));
    assertThat(first.status()).isEqualTo("creating");
    assertThat(first.confirmationUrl()).isNull();
    problem(() -> create(), "billing_purchase_unavailable");
    clock.advance(Duration.ofSeconds(6));
    gateway.failAfterCreate = false;
    try (var executor = Executors.newFixedThreadPool(2)) {
      var responses =
          executor.invokeAll(
              List.<Callable<Payment>>of(
                  () -> billing.create(user, key, new Create("core-season-v1")),
                  () -> billing.create(user, key, new Create("core-season-v1"))));
      for (var response : responses) assertThat(response.get().id()).isEqualTo(first.id());
    }
    assertThat(gateway.payments).hasSize(1);
    assertThat(gateway.creates.get()).isEqualTo(2);
    assertThat(billing.get(user, first.id()).status()).isEqualTo("pending");
    problem(() -> billing.create(user, key, new Create("heavy-season-v1")), "idempotency_conflict");
  }

  @Test
  void uncertainCreationPastWindowRemainsBlockingAndNeverPostsAgain() {
    gateway.failAfterCreate = true;
    var p = create();
    clock.advance(Duration.ofHours(24));
    billing.refresh(user, p.id());
    assertThat(billing.get(user, p.id()).status()).isEqualTo("review_required");
    assertThat(gateway.creates.get()).isEqualTo(1);
    problem(() -> create(), "billing_purchase_unavailable");
  }

  @Test
  void canceledAllowsFreshPurchaseAndWaitingForCaptureDoesNotGrant() {
    var p = create();
    gateway.state("waiting_for_capture");
    clock.advance(Duration.ofSeconds(6));
    assertThat(billing.refresh(user, p.id()).entitlementApplied()).isFalse();
    gateway.state("canceled");
    clock.advance(Duration.ofSeconds(6));
    assertThat(billing.refresh(user, p.id()).status()).isEqualTo("canceled");
    assertThat(create().id()).isNotEqualTo(p.id());
  }

  @Test
  void wrongProviderAmountOrLiveFlagNeverGrantsAndBlocksNewPurchase() {
    gateway.wrongAmount = true;
    var amount = create();
    assertThat(amount.status()).isEqualTo("review_required");
    assertThat(entitlements.active(user)).isNull();
    problem(() -> create(), "billing_purchase_unavailable");
    gateway.wrongAmount = false;
    gateway.live = true;
    var live = billing.create(other, "live-response", new Create("heavy-season-v1"));
    assertThat(live.status()).isEqualTo("review_required");
    assertThat(entitlements.active(other)).isNull();
  }

  @Test
  void earlyUnknownWebhookIsIgnoredAndDurableCreateReconciliationRecovers() {
    gateway.failAfterCreate = true;
    gateway.earlyWebhook =
        () -> {
          gateway.state("succeeded");
          var remote = gateway.payments.values().iterator().next();
          billing.webhook(
              json.read(
                  json.write(
                      Map.of(
                          "type",
                          "notification",
                          "event",
                          "payment.succeeded",
                          "object",
                          remote))));
        };
    var p = create();
    assertThat(entitlements.active(user)).isNull();
    assertThat(gateway.gets.get()).isZero();
    gateway.failAfterCreate = false;
    clock.advance(Duration.ofSeconds(6));
    var recovered = billing.refresh(user, p.id());
    assertThat(recovered.entitlementApplied()).isTrue();
    assertThat(gateway.payments).hasSize(1);
  }

  @Test
  void forgedNotificationCannotOverrideProviderAndOwnershipIsEnforced() {
    var p = create();
    var remote = gateway.payments.values().iterator().next();
    clock.advance(Duration.ofSeconds(6));
    billing.webhook(
        json.read(
            json.write(
                Map.of("type", "notification", "event", "payment.succeeded", "object", remote))));
    assertThat(billing.get(user, p.id()).status()).isEqualTo("pending");
    problem(() -> billing.get(other, p.id()), "not_found");
    UUID stranger = account("stranger@example.test");
    assertThat(billing.offers(stranger).mode()).isEqualTo("disabled");
    problem(
        () -> billing.create(stranger, "key", new Create("light-season-v1")),
        "billing_unavailable");
  }

  @Test
  void liveAiUnsupportedAndCapacityFailuresNeverConsume() throws Exception {
    paid();
    UUID live = submission(16);
    ai.mode = "live";
    problem(() -> submissions.finalizeSubmission(user, live, 1), "billing_sandbox_required");
    ai.mode = "mock";
    UUID unsupported = submission(14);
    assertThat(submissions.finalizeSubmission(user, unsupported, 1).path("status").asText())
        .isEqualTo("unsupported");
    assertThat(billing.status(user).entitlement().checksUsed()).isZero();
  }

  @Test
  void quotaExhaustionIsAtomicAndSeasonExpiryIsFixed() throws Exception {
    paid();
    db.update("UPDATE billing_test_entitlements SET checks_total=1 WHERE user_id=?", user);
    UUID first = submission(16), second = submission(16);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var results =
          executor.invokeAll(
              List.<Callable<Boolean>>of(
                  () -> {
                    try {
                      submissions.finalizeSubmission(user, first, 1);
                      return true;
                    } catch (ApiException e) {
                      return false;
                    }
                  },
                  () -> {
                    try {
                      submissions.finalizeSubmission(user, second, 1);
                      return true;
                    } catch (ApiException e) {
                      return false;
                    }
                  }));
      int successes = 0;
      for (var result : results) if (result.get()) successes++;
      assertThat(successes).isEqualTo(1);
    }
    assertThat(billing.status(user).entitlement().checksRemaining()).isZero();
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_usage", Integer.class))
        .isEqualTo(1);
    var season = billing.create(other, "season", new Create("heavy-season-v1"));
    gateway.state("succeeded");
    clock.advance(Duration.ofSeconds(6));
    billing.refresh(other, season.id());
    assertThat(billing.status(other).entitlement().expiresAt()).isEqualTo(BillingOffers.SEASON_END);
  }

  record Login(String session, String csrf) {}

  String cookie(HttpHeaders headers, String name) {
    return headers.getOrEmpty("Set-Cookie").stream()
        .filter(c -> c.startsWith(name + "="))
        .map(c -> c.substring(name.length() + 1, c.indexOf(';')))
        .findFirst()
        .orElse(null);
  }

  ResponseEntity<String> http(String method, String path, Login login, String body) {
    var h = new HttpHeaders();
    h.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
    h.set(
        "Cookie",
        (login.session == null ? "" : "SESSION=" + login.session + "; ")
            + (login.csrf == null ? "" : "XSRF-TOKEN=" + login.csrf));
    if (login.csrf != null) h.set("X-XSRF-TOKEN", login.csrf);
    h.set("Idempotency-Key", "http-test");
    return rest.exchange(path, HttpMethod.valueOf(method), new HttpEntity<>(body, h), String.class);
  }

  Login login() {
    var csrf = rest.getForEntity("/api/auth/csrf", String.class);
    var response =
        http(
            "POST",
            "/api/auth/login",
            new Login(null, cookie(csrf.getHeaders(), "XSRF-TOKEN")),
            "{\"email\":\"billing@example.test\",\"password\":\"test-secure-password\"}");
    assertThat(response.getStatusCode().value()).isEqualTo(200);
    String session = cookie(response.getHeaders(), "SESSION");
    var token = http("GET", "/api/auth/csrf", new Login(session, null), null);
    return new Login(session, cookie(token.getHeaders(), "XSRF-TOKEN"));
  }

  @Test
  void httpCsrfTamperingAndExactWebhookException() {
    var auth = login();
    assertThat(
            http(
                    "POST",
                    "/api/billing/payments",
                    new Login(auth.session, null),
                    "{\"offerId\":\"light-season-v1\"}")
                .getStatusCode()
                .value())
        .isEqualTo(403);
    assertThat(
            http(
                    "POST",
                    "/api/billing/payments",
                    auth,
                    "{\"offerId\":\"light-season-v1\",\"amount\":1}")
                .getStatusCode()
                .value())
        .isEqualTo(400);
    assertThat(rest.getForEntity("/api/billing/status", String.class).getStatusCode().value())
        .isEqualTo(401);
    assertThat(
            http(
                    "POST",
                    "/api/billing/yookassa/test/webhook",
                    new Login(null, null),
                    "{\"type\":\"notification\",\"event\":\"payment.succeeded\",\"object\":{\"id\":\"unknown\"}}")
                .getStatusCode()
                .value())
        .isEqualTo(200);
    assertThat(
            rest.getForEntity("/api/billing/yookassa/test/webhook", String.class)
                .getStatusCode()
                .value())
        .isEqualTo(401);
    assertThat(
            http(
                    "POST",
                    "/api/billing/yookassa/test/webhook",
                    new Login(null, null),
                    "x".repeat(17000))
                .getStatusCode()
                .value())
        .isEqualTo(413);
    assertThat(gateway.creates.get()).isZero();
  }

  @Test
  void expectedQuotaAndExpiryDenialsRemainHttpProblemsAndMixedBatchKeepsShortAnswers()
      throws Exception {
    paid();
    db.update("UPDATE billing_test_entitlements SET checks_total=1 WHERE user_id=?", user);
    var auth = login();
    UUID first = submission(16);
    assertThat(
            http(
                    "POST",
                    "/api/submissions/" + first + "/finalize",
                    auth,
                    "{\"expectedRevision\":1}")
                .getStatusCode()
                .value())
        .isEqualTo(200);
    UUID exhausted = submission(16);
    var quota =
        http(
            "POST",
            "/api/submissions/" + exhausted + "/finalize",
            auth,
            "{\"expectedRevision\":1}");
    assertThat(quota.getStatusCode().value()).isEqualTo(429);
    assertThat(quota.getBody()).contains("billing_quota_exhausted");
    clock.now = BillingOffers.SEASON_END.plusSeconds(1);
    UUID expired = submission(16);
    var expiry =
        http("POST", "/api/submissions/" + expired + "/finalize", auth, "{\"expectedRevision\":1}");
    assertThat(expiry.getStatusCode().value()).isEqualTo(403);
    assertThat(expiry.getBody()).contains("ai_review_required");
    var mixed =
        attempts.startTraining(
            user,
            UUID.randomUUID().toString(),
            new AttemptDtos.TrainingRequest(
                CatalogRepository.FORMAT,
                List.of(
                    new AttemptDtos.Selection(7, null, 1), new AttemptDtos.Selection(16, null, 1)),
                null,
                "catalog",
                null));
    var shortItem =
        mixed.items().stream().filter(i -> i.task().examNumber() == 7).findFirst().orElseThrow();
    var photo =
        mixed.items().stream().filter(i -> i.task().examNumber() == 16).findFirst().orElseThrow();
    var changed =
        attempts.patch(
            user,
            mixed.id(),
            new AttemptDtos.Patch(
                mixed.revision(),
                null,
                List.of(
                    new AttemptDtos.ItemPatch(
                        shortItem.id(),
                        catalog
                            .snapshot(shortItem.task().taskVersionId())
                            .acceptedAnswers()
                            .getFirst(),
                        null))));
    UUID photoSubmission =
        UUID.fromString(
            submissions
                .create(
                    user,
                    UUID.randomUUID().toString(),
                    new SubmissionService.Intent(mixed.id(), photo.id(), 0, null))
                .path("id")
                .asText());
    var out = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB), "png", out);
    media.upload(
        user,
        photoSubmission,
        new MockMultipartFile("file", "test.png", "image/png", out.toByteArray()));
    var result =
        http(
            "POST",
            "/api/attempts/" + mixed.id() + "/checks",
            auth,
            json.write(
                new SubmissionService.Check(attempts.get(user, mixed.id()).revision(), null)));
    assertThat(result.getStatusCode().value()).as(result.getBody()).isEqualTo(200);
    assertThat(json.read(result.getBody()).path("summary").path("graded").asInt()).isEqualTo(1);
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_usage", Integer.class))
        .isEqualTo(1);
    assertThat(
            db.queryForObject(
                "SELECT status FROM grading_submissions WHERE id=?", String.class, photoSubmission))
        .isEqualTo("draft");
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM submission_events WHERE submission_id=? AND"
                    + " event_type='batch_check_skipped'",
                Integer.class,
                photoSubmission))
        .isEqualTo(1);
  }

  @Test
  void expiryIsEvaluatedAfterWaitingForTheUserLock() throws Exception {
    paid();
    UUID pending = submission(16);
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var holder =
          executor.submit(
              () ->
                  tx.executeWithoutResult(
                      t -> {
                        db.queryForObject(
                            "SELECT id FROM users WHERE id=? FOR UPDATE", UUID.class, user);
                        locked.countDown();
                        try {
                          assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                        } catch (InterruptedException e) {
                          throw new RuntimeException(e);
                        }
                      }));
      assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
      var waiting =
          executor.submit(
              () -> {
                try {
                  submissions.finalizeSubmission(user, pending, 1);
                  return "allowed";
                } catch (ApiException e) {
                  return e.code();
                }
              });
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      boolean blocked = false;
      while (System.nanoTime() < deadline) {
        blocked =
            db.queryForObject(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND"
                        + " wait_event_type='Lock' AND query LIKE 'SELECT plan_id FROM users%'",
                    Integer.class)
                > 0;
        if (blocked) break;
        Thread.sleep(10);
      }
      assertThat(blocked)
          .as("admission transaction is waiting for the locked user before time advances")
          .isTrue();
      clock.now = BillingOffers.SEASON_END.plusSeconds(1);
      release.countDown();
      holder.get();
      assertThat(waiting.get()).isEqualTo("ai_review_required");
    }
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_usage", Integer.class))
        .isZero();
  }

  @Test
  void staleCompletionCannotClearNewLeaseOrDowngradeConfirmedSuccess() throws Exception {
    var p = create();
    clock.advance(Duration.ofSeconds(6));
    var oldGate = new TestGateway.Gate(new CountDownLatch(1), new CountDownLatch(1));
    gateway.nextGate.set(oldGate);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var old = executor.submit(() -> billing.refresh(user, p.id()));
      assertThat(oldGate.entered.await(5, TimeUnit.SECONDS)).isTrue();
      clock.advance(Duration.ofSeconds(46));
      gateway.state("succeeded");
      var newGate = new TestGateway.Gate(new CountDownLatch(1), new CountDownLatch(1));
      gateway.nextGate.set(newGate);
      var current = executor.submit(() -> billing.refresh(user, p.id()));
      assertThat(newGate.entered.await(5, TimeUnit.SECONDS)).isTrue();
      oldGate.release.countDown();
      old.get();
      clock.advance(Duration.ofSeconds(6));
      int calls = gateway.gets.get();
      billing.refresh(user, p.id());
      assertThat(gateway.gets.get()).isEqualTo(calls);
      newGate.release.countDown();
      assertThat(current.get().status()).isEqualTo("succeeded");
      assertThat(billing.get(user, p.id()).entitlementApplied()).isTrue();
    }
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_entitlements", Integer.class))
        .isEqualTo(1);
  }

  SubscriptionCreated subscribe() {
    return billing.createSubscription(
        user,
        UUID.randomUUID().toString(),
        new CreateSubscription(
            "core-month-subscription-v1", new Consent(true, BillingOffers.CONSENT_VERSION)));
  }

  SubscriptionCreated subscribed() {
    var created = subscribe();
    gateway.state("succeeded");
    clock.advance(Duration.ofSeconds(6));
    billing.refresh(user, created.payment().id());
    return new SubscriptionCreated(
        billing.subscription(user, created.subscription().id()),
        billing.get(user, created.payment().id()));
  }

  void succeed(UUID payment) {
    gateway.state("succeeded");
    clock.advance(Duration.ofSeconds(6));
    billing.refresh(user, payment);
  }

  @Test
  void subscriptionPaidPeriodsEarlyRenewalAndCancelPreserveAccessWithoutRollover() {
    var initial = subscribed();
    UUID sub = initial.subscription().id();
    var first = billing.subscription(user, sub);
    assertThat(first.renewalEnabled()).isTrue();
    assertThat(first.currentPeriod().sequence()).isEqualTo(1);
    assertThat(first.nextPaymentAt()).isEqualTo(first.paidThrough());
    assertThat(gateway.payloads.values().iterator().next()).contains("save_payment_method");
    var repeat = billing.earlyQaRenewal(sub);
    assertThat(repeat.purpose()).isEqualTo("subscription_renewal");
    assertThat(repeat.periodSequence()).isEqualTo(2);
    assertThat(gateway.payloads.values())
        .anyMatch(
            v ->
                v.contains("payment_method_id")
                    && !v.contains("save_payment_method")
                    && !v.contains("confirmation"));
    succeed(repeat.id());
    var prepaid = billing.subscription(user, sub);
    assertThat(prepaid.paidThrough()).isEqualTo(first.paidThrough().plus(Duration.ofDays(30)));
    assertThat(prepaid.nextPaymentAt()).isEqualTo(prepaid.paidThrough());
    assertThat(prepaid.currentPeriod().sequence()).isEqualTo(1);
    int posts = gateway.creates.get();
    problem(() -> billing.earlyQaRenewal(sub), "billing_purchase_unavailable");
    clock.now = first.paidThrough();
    assertThat(billing.prepareRenewal(sub, false)).isNull();
    assertThat(billing.subscription(user, sub).currentPeriod().sequence()).isEqualTo(2);
    var canceled = billing.cancelSubscription(user, sub);
    assertThat(canceled.status()).isEqualTo("canceled");
    assertThat(canceled.renewalEnabled()).isFalse();
    assertThat(canceled.nextPaymentAt()).isNull();
    assertThat(canceled.paidThrough()).isEqualTo(prepaid.paidThrough());
    billing.cancelSubscription(user, sub);
    assertThat(billing.status(user).canPurchase()).isFalse();
    clock.now = prepaid.paidThrough();
    assertThat(billing.status(user).canPurchase()).isTrue();
    assertThat(billing.prepareRenewal(sub, false)).isNull();
    assertThat(gateway.creates.get()).isEqualTo(posts);
    assertThat(db.queryForObject("SELECT plan_id FROM users WHERE id=?", String.class, user))
        .isEqualTo("free");
  }

  @Test
  void normalDueSchedulerNoCatchupAndConcurrentEarlyWorkerCannotDoubleCreate() throws Exception {
    var initial = subscribed();
    UUID sub = initial.subscription().id();
    Instant due = initial.subscription().paidThrough();
    try (var pool = Executors.newFixedThreadPool(3)) {
      var outcomes =
          pool.invokeAll(
              List.<Callable<UUID>>of(
                  () -> billing.prepareRenewal(sub, true),
                  () -> billing.prepareRenewal(sub, true),
                  () -> billing.prepareRenewal(sub, false)));
      int created = 0;
      UUID payment = null;
      for (var f : outcomes)
        if (f.get() != null) {
          created++;
          payment = f.get();
        }
      assertThat(created).isEqualTo(1);
      billing.reconcile(payment);
      succeed(payment);
    }
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_subscription_periods WHERE subscription_id=?",
                Integer.class,
                sub))
        .isEqualTo(2);
    clock.now = due.plus(Duration.ofDays(100));
    UUID next = billing.prepareRenewal(sub, false);
    assertThat(next).isNotNull();
    billing.reconcile(next);
    succeed(next);
    var latest = billing.subscription(user, sub);
    assertThat(latest.currentPeriod().sequence()).isEqualTo(3);
    assertThat(latest.currentPeriod().startsAt()).isEqualTo(clock.now());
    assertThat(billing.prepareRenewal(sub, false)).isNull();
  }

  @Test
  void savedFalseGrantsPaidPeriodAndDeclineNeverRetriesANewCharge() {
    gateway.saved = false;
    var withoutMethod = subscribed();
    assertThat(withoutMethod.subscription().renewalEnabled()).isFalse();
    assertThat(withoutMethod.subscription().actionRequired()).isEqualTo("payment_method_required");
    assertThat(withoutMethod.payment().entitlementApplied()).isTrue();
    assertThat(withoutMethod.payment().status()).isEqualTo("succeeded");
    assertThat(
            db.queryForObject(
                "SELECT payment_method_id FROM billing_test_subscriptions WHERE id=?",
                String.class,
                withoutMethod.subscription().id()))
        .isNull();
    clock.now = withoutMethod.subscription().paidThrough();
    gateway.saved = true;
    var withMethod = subscribed();
    UUID sub = withMethod.subscription().id();
    var renewal = billing.earlyQaRenewal(sub);
    gateway.state("canceled");
    clock.advance(Duration.ofSeconds(6));
    billing.refresh(user, renewal.id());
    var failed = billing.subscription(user, sub);
    assertThat(failed.status()).isEqualTo("payment_failed");
    assertThat(failed.renewalEnabled()).isFalse();
    assertThat(failed.actionRequired()).isEqualTo("payment_failed");
    assertThat(failed.currentPeriod()).isNotNull();
    int calls = gateway.creates.get();
    clock.advance(Duration.ofDays(31));
    assertThat(billing.prepareRenewal(sub, false)).isNull();
    billing.refresh(user, renewal.id());
    assertThat(gateway.creates.get()).isEqualTo(calls);
    assertThat(billing.status(user).canPurchase()).isTrue();
  }

  @Test
  void firstDeclineConsentOwnershipAndOneOffNeverStoresMethod() {
    String key = "consent";
    problem(
        () ->
            billing.createSubscription(
                user, key, new CreateSubscription("core-month-subscription-v1", null)),
        "recurring_consent_required");
    problem(
        () ->
            billing.createSubscription(
                user,
                key,
                new CreateSubscription("core-month-subscription-v1", new Consent(true, "old"))),
        "recurring_consent_changed");
    assertThat(gateway.creates.get()).isZero();
    assertThat(db.queryForObject("SELECT count(*) FROM billing_test_subscriptions", Integer.class))
        .isZero();
    var first = subscribe();
    problem(() -> billing.subscription(other, first.subscription().id()), "not_found");
    problem(() -> billing.cancelSubscription(other, first.subscription().id()), "not_found");
    gateway.state("canceled");
    clock.advance(Duration.ofSeconds(6));
    billing.refresh(user, first.payment().id());
    assertThat(billing.status(user).canPurchase()).isTrue();
    assertThat(entitlements.active(user)).isNull();
    var pack = paid();
    assertThat(pack.purpose()).isEqualTo("one_time");
    assertThat(pack.subscriptionId()).isNull();
    var payload =
        db.queryForObject(
            "SELECT provider_request FROM billing_test_payments WHERE id=?",
            String.class,
            pack.id());
    assertThat(payload).doesNotContain("save_payment_method", "payment_method_id");
    var auth = login();
    assertThat(
            http(
                    "POST",
                    "/api/billing/subscriptions",
                    auth,
                    "{\"offerId\":\"core-month-subscription-v1\",\"consent\":{\"accepted\":true,\"version\":\"test-recurring-v1\"},\"paymentMethodId\":\"forged\"}")
                .getStatusCode()
                .value())
        .isEqualTo(400);
  }

  @Test
  void cancelBeforeAuthorizationForbidsPostAndAfterAuthorizationReportsInflight() throws Exception {
    var first = subscribed();
    UUID sub = first.subscription().id();
    UUID notSent = billing.prepareRenewal(sub, true);
    int posts = gateway.creates.get();
    billing.cancelSubscription(user, sub);
    billing.reconcile(notSent);
    assertThat(gateway.creates.get()).isEqualTo(posts);
    assertThat(billing.get(user, notSent).status()).isEqualTo("canceled");
    clock.now = first.subscription().paidThrough();
    var second = subscribed();
    var gate = new TestGateway.Gate(new CountDownLatch(1), new CountDownLatch(1));
    gateway.createGate.set(gate);
    try (var pool = Executors.newSingleThreadExecutor()) {
      var send = pool.submit(() -> billing.earlyQaRenewal(second.subscription().id()));
      assertThat(gate.entered.await(5, TimeUnit.SECONDS)).isTrue();
      var stopped = billing.cancelSubscription(user, second.subscription().id());
      assertThat(stopped.inFlightPaymentId()).isNotNull();
      assertThat(stopped.renewalEnabled()).isFalse();
      gate.release.countDown();
      var pending = send.get();
      succeed(pending.id());
      var late = billing.subscription(user, second.subscription().id());
      assertThat(late.renewalEnabled()).isFalse();
      assertThat(late.status()).isEqualTo("canceled");
      assertThat(late.paidThrough()).isAfter(second.subscription().paidThrough());
    }
  }

  @Test
  void unknownCreateCancellationNeverRetriesPostAndPendingInitialConsentCanBeRevoked() {
    gateway.failAfterCreate = true;
    String key = "unknown-initial";
    var initial =
        billing.createSubscription(
            user,
            key,
            new CreateSubscription(
                "light-month-subscription-v1", new Consent(true, BillingOffers.CONSENT_VERSION)));
    assertThat(initial.subscription().status()).isEqualTo("pending_initial");
    assertThat(initial.subscription().renewalEnabled()).isFalse();
    billing.cancelSubscription(user, initial.subscription().id());
    gateway.failAfterCreate = false;
    clock.advance(Duration.ofSeconds(6));
    billing.refresh(user, initial.payment().id());
    assertThat(billing.get(user, initial.payment().id()).status()).isEqualTo("review_required");
    assertThat(gateway.creates.get()).isEqualTo(1);
    assertThat(billing.status(user).canPurchase()).isFalse();
    assertThat(billing.status(user).currentPaymentId()).isEqualTo(initial.payment().id());
    var otherInitial =
        billing.createSubscription(
            other,
            "other",
            new CreateSubscription(
                "light-month-subscription-v1", new Consent(true, BillingOffers.CONSENT_VERSION)));
    billing.cancelSubscription(other, otherInitial.subscription().id());
    gateway.state("succeeded");
    clock.advance(Duration.ofSeconds(6));
    assertThat(billing.refresh(other, otherInitial.payment().id()).entitlementApplied()).isTrue();
    assertThat(billing.subscription(other, otherInitial.subscription().id()).renewalEnabled())
        .isFalse();
  }

  @Test
  void validZeroConsumesRejectedAndTechnicalFailureReleaseExactlyOnce() throws Exception {
    subscribed();
    UUID zero = submission(16);
    submissions.finalizeSubmission(user, zero, 1);
    var zeroClaim = worker.claim();
    worker.dispatch(zeroClaim);
    assertThat(entitlements.active(user).checksReserved()).isEqualTo(1);
    worker.complete(
        zeroClaim,
        new GradingGateway.Response("{}", "mock", "fixture", null),
        new AiResponseValidator.Validated(true, 0, null, Map.of(), true));
    assertThat(entitlements.active(user).checksUsed()).isEqualTo(1);
    assertThat(entitlements.active(user).checksReserved()).isZero();
    worker.complete(
        zeroClaim,
        new GradingGateway.Response("{}", "mock", "fixture", null),
        new AiResponseValidator.Validated(true, 0, null, Map.of(), true));
    assertThat(entitlements.active(user).checksUsed()).isEqualTo(1);
    UUID rejected = submission(16);
    submissions.finalizeSubmission(user, rejected, 1);
    var reject = worker.claim();
    worker.dispatch(reject);
    worker.complete(
        reject,
        new GradingGateway.Response("{}", "mock", "fixture", null),
        new AiResponseValidator.Validated(false, null, "unreadable", null, true));
    assertThat(entitlements.active(user).checksUsed()).isEqualTo(1);
    assertThat(entitlements.active(user).checksReserved()).isZero();
    UUID failed = submission(16);
    submissions.finalizeSubmission(user, failed, 1);
    worker.execute(worker.claim());
    assertThat(entitlements.active(user).checksUsed()).isEqualTo(1);
    assertThat(entitlements.active(user).checksRemaining()).isEqualTo(69);
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_usage_settlements WHERE outcome='release'",
                Integer.class))
        .isEqualTo(2);
  }

  @Test
  void cancellationAfterDispatchHoldsUntilSealedAndRequeueKeepsReservation() throws Exception {
    subscribed();
    UUID id = submission(16);
    submissions.finalizeSubmission(user, id, 1);
    var first = worker.claim();
    db.update(
        "UPDATE grading_jobs SET lease_until=now()-interval '1 second' WHERE submission_id=?", id);
    worker.reap();
    assertThat(entitlements.active(user).checksReserved()).isEqualTo(1);
    assertThat(
            db.queryForObject(
                "SELECT state FROM grading_jobs WHERE submission_id=?", String.class, id))
        .isEqualTo("ready");
    var live = worker.claim();
    worker.dispatch(live);
    submissions.cancel(user, id);
    assertThat(entitlements.active(user).checksReserved()).isEqualTo(1);
    tx.executeWithoutResult(t -> entitlements.settle(id));
    assertThat(entitlements.active(user).checksReserved()).isEqualTo(1);
    db.update(
        "UPDATE grading_jobs SET lease_until=now()-interval '1 second' WHERE submission_id=?", id);
    worker.reap();
    assertThat(entitlements.active(user).checksReserved()).isZero();
    assertThat(entitlements.active(user).checksUsed()).isZero();
    worker.complete(
        live,
        new GradingGateway.Response("{}", "mock", "fixture", null),
        new AiResponseValidator.Validated(true, 2, null, Map.of(), true));
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM grading_results WHERE submission_id=?", Integer.class, id))
        .isZero();
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_usage_settlements WHERE submission_id=?",
                Integer.class,
                id))
        .isEqualTo(1);
    UUID queued = submission(16);
    submissions.finalizeSubmission(user, queued, 1);
    submissions.cancel(user, queued);
    assertThat(entitlements.active(user).checksReserved()).isZero();
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM submission_events WHERE event_type='queued' AND submission_id"
                    + " IN(?,?)",
                Integer.class,
                id,
                queued))
        .isEqualTo(2);
  }

  @Test
  void delayedResultSettlesOriginalPeriodWithoutSpendingNewQuota() throws Exception {
    var initial = subscribed();
    UUID id = submission(16);
    submissions.finalizeSubmission(user, id, 1);
    var claim = worker.claim();
    worker.dispatch(claim);
    var early = billing.earlyQaRenewal(initial.subscription().id());
    succeed(early.id());
    clock.now = initial.subscription().paidThrough();
    assertThat(entitlements.active(user).checksRemaining()).isEqualTo(70);
    worker.complete(
        claim,
        new GradingGateway.Response("{}", "mock", "fixture", null),
        new AiResponseValidator.Validated(true, 2, null, Map.of(), true));
    assertThat(entitlements.active(user).checksRemaining()).isEqualTo(70);
    assertThat(entitlements.forPayment(initial.payment().id()).checksUsed()).isEqualTo(1);
  }

  @Test
  void newRedirectPaymentsPinRussianLocale() {
    var oneOff = create();
    var initial =
        billing.createSubscription(
            other,
            "russian-checkout",
            new CreateSubscription(
                "light-month-subscription-v1", new Consent(true, BillingOffers.CONSENT_VERSION)));
    for (UUID id : List.of(oneOff.id(), initial.payment().id())) {
      String payload =
          db.queryForObject(
              "SELECT provider_request FROM billing_test_payments WHERE id=?", String.class, id);
      var confirmation = json.read(payload).path("confirmation");
      assertThat(confirmation.path("type").asText()).isEqualTo("redirect");
      assertThat(confirmation.path("locale").asText()).isEqualTo("ru_RU");
      assertThat(gateway.payloads.values()).contains(payload);
    }
  }

  @Test
  void legacyMonthReplayRetainsImmutablePayloadAndHistoricalKind() {
    UUID id = UUID.randomUUID(), key = UUID.randomUUID();
    String payload =
        json.write(
            Map.of(
                "amount",
                new Amount("299.00", "RUB"),
                "capture",
                true,
                "confirmation",
                Map.of(
                    "type",
                    "redirect",
                    "return_url",
                    "http://localhost:13002/billing/return?paymentId=" + id),
                "metadata",
                Map.of("botai_order_id", id.toString())));
    db.update(
        "INSERT INTO"
            + " billing_test_payments(id,user_id,idempotency_key,offer_id,plan,period,amount_minor,checks_total,duration_days,return_url,shop_id,provider_key,provider_request,next_check_at)"
            + " VALUES(?,?,'legacy-month','light-month-v1','light','month',29900,30,30,'http://localhost:13002/billing/return','12345',?,?,?)",
        id,
        user,
        key,
        payload,
        java.sql.Timestamp.from(clock.now()));
    var resumed = billing.create(user, "legacy-month", new Create("light-month-v1"));
    assertThat(resumed.id()).isEqualTo(id);
    assertThat(resumed.purpose()).isEqualTo("one_time");
    assertThat(resumed.offer().kind()).isEqualTo("one_time");
    assertThat(resumed.offer().autoRenew()).isFalse();
    assertThat(gateway.payloads.get(key)).isEqualTo(payload);
    succeed(id);
    assertThat(entitlements.active(user).checksTotal()).isEqualTo(30);
    assertThat(billing.offers(user).offers()).noneMatch(o -> o.id().equals("light-month-v1"));
  }

  @Test
  void concurrentSubscriptionCreationAndUnknownRenewalKeepSameKeyUntilWindow() throws Exception {
    String key = "same-sub";
    var input =
        new CreateSubscription(
            "light-month-subscription-v1", new Consent(true, BillingOffers.CONSENT_VERSION));
    try (var pool = Executors.newFixedThreadPool(2)) {
      var responses =
          pool.invokeAll(
              List.<Callable<SubscriptionCreated>>of(
                  () -> billing.createSubscription(user, key, input),
                  () -> billing.createSubscription(user, key, input)));
      assertThat(responses.get(0).get().subscription().id())
          .isEqualTo(responses.get(1).get().subscription().id());
    }
    assertThat(gateway.creates.get()).isEqualTo(1);
    var sub = billing.status(user).subscription();
    succeed(sub.currentPaymentId());
    gateway.failAfterCreate = true;
    var renewal = billing.earlyQaRenewal(sub.id());
    String frozen =
        db.queryForObject(
            "SELECT provider_request FROM billing_test_payments WHERE id=?",
            String.class,
            renewal.id());
    clock.advance(Duration.ofSeconds(6));
    problem(() -> billing.refresh(user, renewal.id()), "billing_provider_unavailable");
    assertThat(gateway.payments).hasSize(2);
    assertThat(gateway.creates.get()).isEqualTo(3);
    assertThat(
            db.queryForObject(
                "SELECT provider_request FROM billing_test_payments WHERE id=?",
                String.class,
                renewal.id()))
        .isEqualTo(frozen);
    clock.advance(Duration.ofHours(24));
    billing.refresh(user, renewal.id());
    assertThat(billing.get(user, renewal.id()).status()).isEqualTo("review_required");
    assertThat(gateway.creates.get()).isEqualTo(3);
    assertThat(billing.status(user).canPurchase()).isFalse();
  }

  @Test
  void legacyUncertainReservationSealsOnlyInEnabledRuntime() throws Exception {
    subscribed();
    UUID id = submission(16);
    submissions.finalizeSubmission(user, id, 1);
    var claim = worker.claim();
    worker.dispatch(claim);
    // Simulate V13 cancellation: terminal + done, but run not durably sealed yet.
    db.update("UPDATE grading_submissions SET status='cancelled' WHERE id=?", id);
    db.update("UPDATE grading_jobs SET state='done',lease_until=NULL WHERE submission_id=?", id);
    var disabledService = org.mockito.Mockito.mock(SubmissionService.class);
    org.mockito.Mockito.when(disabledService.sandboxBillingEnabled()).thenReturn(false);
    var disabledWorker =
        new GradingWorker(
            new SubmissionStore(db, json),
            disabledService,
            catalog,
            profiles,
            new TestStorage(),
            ai,
            tx,
            media,
            false);
    long fence =
        db.queryForObject(
            "SELECT fencing_token FROM grading_jobs WHERE submission_id=?", Long.class, id);
    disabledWorker.reap();
    assertThat(
            db.queryForObject(
                "SELECT fencing_token FROM grading_jobs WHERE submission_id=?", Long.class, id))
        .isEqualTo(fence);
    assertThat(entitlements.active(user).checksReserved()).isEqualTo(1);
    worker.reap();
    assertThat(entitlements.active(user).checksReserved()).isZero();
    assertThat(
            db.queryForObject(
                "SELECT outcome FROM grading_runs WHERE submission_id=?", String.class, id))
        .isEqualTo("no_result_finalized");
    worker.reap();
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_usage_settlements WHERE submission_id=?",
                Integer.class,
                id))
        .isEqualTo(1);
  }

  @Test
  void cancellationResultRaceProducesExactlyOneSettlementAndNoLateGrade() throws Exception {
    subscribed();
    try (var pool = Executors.newFixedThreadPool(2)) {
      for (int n = 0; n < 4; n++) {
        UUID id = submission(16);
        submissions.finalizeSubmission(user, id, 1);
        var claim = worker.claim();
        worker.dispatch(claim);
        var start = new CountDownLatch(1);
        var a =
            pool.submit(
                () -> {
                  start.await();
                  submissions.cancel(user, id);
                  return null;
                });
        var b =
            pool.submit(
                () -> {
                  start.await();
                  worker.complete(
                      claim,
                      new GradingGateway.Response("{}", "mock", "fixture", null),
                      new AiResponseValidator.Validated(true, 2, null, Map.of(), true));
                  return null;
                });
        start.countDown();
        a.get();
        b.get();
        String
            status =
                db.queryForObject(
                    "SELECT status FROM grading_submissions WHERE id=?", String.class, id),
            outcome =
                db.queryForObject(
                    "SELECT outcome FROM billing_test_usage_settlements WHERE submission_id=?",
                    String.class,
                    id);
        assertThat(outcome).isEqualTo(status.equals("graded") ? "consume" : "release");
        assertThat(
                db.queryForObject(
                    "SELECT count(*) FROM grading_results WHERE submission_id=? AND is_graded",
                    Integer.class,
                    id))
            .isEqualTo(status.equals("graded") ? 1 : 0);
      }
    }
    assertThat(entitlements.active(user).checksReserved()).isZero();
  }

  @Test
  void historicalSubscriptionDoesNotOverrideNewPackAndStoredConsentVersionIsPreserved() {
    var initial = subscribed();
    UUID sub = initial.subscription().id();
    db.update(
        "UPDATE billing_test_subscriptions SET consent_version='test-recurring-old-fixture' WHERE"
            + " id=?",
        sub);
    assertThat(billing.get(user, initial.payment().id()).offer().consentVersion())
        .isEqualTo("test-recurring-old-fixture");
    assertThat(billing.subscription(user, sub).offer().consentVersion())
        .isEqualTo("test-recurring-old-fixture");
    billing.cancelSubscription(user, sub);
    clock.now = initial.subscription().paidThrough();
    var pack = paid();
    assertThat(billing.status(user).subscription()).isNull();
    assertThat(billing.status(user).entitlement().expiresAt()).isEqualTo(BillingOffers.SEASON_END);
    assertThat(billing.subscription(user, sub).status()).isEqualTo("canceled");
  }

  @Test
  void knownWebhookAuditIsBoundedAndUnknownDoesNotLogOrFetch() {
    var payment = create();
    String provider = gateway.payments.values().iterator().next().path("id").asText();
    var logger =
        (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(BillingService.class);
    var appender =
        new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
    appender.start();
    logger.addAppender(appender);
    try {
      int gets = gateway.gets.get();
      billing.webhook(
          json.read(
              "{\"type\":\"notification\",\"event\":\"payment.succeeded\",\"object\":{\"id\":\"unknown\",\"private\":\"never-log-this\"}}"));
      assertThat(appender.list).isEmpty();
      assertThat(gateway.gets.get()).isEqualTo(gets);
      clock.advance(Duration.ofSeconds(6));
      billing.webhook(
          json.read(
              json.write(
                  Map.of(
                      "type",
                      "notification",
                      "event",
                      "payment.succeeded",
                      "object",
                      Map.of("id", provider, "private", "never-log-this")))));
      assertThat(appender.list).hasSize(1);
      String message = appender.list.getFirst().getFormattedMessage();
      assertThat(message)
          .contains(
              "route=/api/billing/yookassa/test/webhook",
              "requestId=",
              "paymentId=" + payment.id(),
              "event=payment.succeeded",
              "status=200")
          .doesNotContain(provider, "never-log-this", "test_fixture_only");
    } finally {
      logger.detachAppender(appender);
      appender.stop();
    }
  }

  @Test
  void originalConsentRetrySurvivesCatalogVersionChangeButNewObsoleteConsentFails() {
    gateway.failAfterCreate = true;
    var created = subscribe();
    String key =
        db.queryForObject(
            "SELECT idempotency_key FROM billing_test_payments WHERE id=?",
            String.class,
            created.payment().id());
    String payload =
        db.queryForObject(
            "SELECT provider_request FROM billing_test_payments WHERE id=?",
            String.class,
            created.payment().id());
    UUID providerKey =
        db.queryForObject(
            "SELECT provider_key FROM billing_test_payments WHERE id=?",
            UUID.class,
            created.payment().id());
    // Represents a pending historical intent whose immutable consent predates the current catalog.
    db.update(
        "UPDATE billing_test_subscriptions SET consent_version='test-recurring-old-fixture' WHERE"
            + " id=?",
        created.subscription().id());
    var historical =
        new CreateSubscription(
            "core-month-subscription-v1", new Consent(true, "test-recurring-old-fixture"));
    gateway.failAfterCreate = false;
    clock.advance(Duration.ofSeconds(6));
    var replay = billing.createSubscription(user, key, historical);
    assertThat(replay.payment().id()).isEqualTo(created.payment().id());
    assertThat(replay.subscription().id()).isEqualTo(created.subscription().id());
    assertThat(replay.payment().offer().consentVersion()).isEqualTo("test-recurring-old-fixture");
    assertThat(gateway.payloads.get(providerKey)).isEqualTo(payload);
    assertThat(gateway.payments).hasSize(1);
    problem(
        () -> billing.createSubscription(user, "fresh-obsolete", historical),
        "recurring_consent_changed");
    problem(
        () ->
            billing.createSubscription(
                user,
                key,
                new CreateSubscription(
                    "core-month-subscription-v1",
                    new Consent(true, BillingOffers.CONSENT_VERSION))),
        "idempotency_conflict");
    assertThat(gateway.creates.get()).isEqualTo(2);
  }

  BillingService restarted() {
    return restarted(gateway);
  }

  BillingService restarted(BillingGateway transport) {
    return new BillingService(db, tx, config, clock, transport, entitlements, json, true);
  }

  JsonNode callback(UUID local, String provider) {
    return json.read(
        json.write(
            Map.of(
                "type",
                "notification",
                "event",
                "payment.succeeded",
                "object",
                Map.of("id", provider, "metadata", Map.of("botai_order_id", local.toString())))));
  }

  String providerId(UUID payment) {
    return gateway.payments.values().stream()
        .filter(p -> p.path("metadata").path("botai_order_id").asText().equals(payment.toString()))
        .findFirst()
        .orElseThrow()
        .path("id")
        .asText();
  }

  @Test
  void autonomousSchedulerCreditsKnownPaidAfterTwentyDaysWithoutUiOrNewPost() {
    var initial = subscribe();
    String provider = providerId(initial.payment().id());
    int posts = gateway.creates.get();
    gateway.state("succeeded");
    clock.advance(Duration.ofDays(20));
    var afterRestart = restarted();
    afterRestart.reconcilePending();
    assertThat(afterRestart.get(user, initial.payment().id()).status()).isEqualTo("succeeded");
    assertThat(entitlements.active(user).checksTotal()).isEqualTo(70);
    assertThat(gateway.creates.get()).isEqualTo(posts);
    assertThat(
            db.queryForObject(
                "SELECT provider_id FROM billing_test_payments WHERE id=?",
                String.class,
                initial.payment().id()))
        .isEqualTo(provider);
    restarted().reconcilePending();
    afterRestart.webhook(callback(initial.payment().id(), provider));
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_entitlements WHERE payment_id=?",
                Integer.class,
                initial.payment().id()))
        .isEqualTo(1);
    assertThat(gateway.creates.get()).isEqualTo(posts);
  }

  @Test
  void restartAfterKnownIdButBeforeGrantUsesGetAndWaitsForAbandonedLease() {
    gateway.failGet = true;
    var initial = subscribe();
    assertThat(
            db.queryForObject(
                "SELECT provider_id FROM billing_test_payments WHERE id=?",
                String.class,
                initial.payment().id()))
        .isNotNull();
    assertThat(initial.payment().entitlementApplied()).isFalse();
    gateway.failGet = false;
    gateway.state("succeeded");
    db.update(
        "UPDATE billing_test_payments SET lease_token=?,lease_until=?,next_check_at=? WHERE id=?",
        UUID.randomUUID(),
        java.sql.Timestamp.from(clock.now().plusSeconds(45)),
        java.sql.Timestamp.from(clock.now()),
        initial.payment().id());
    int gets = gateway.gets.get();
    restarted().reconcilePending();
    assertThat(gateway.gets.get()).isEqualTo(gets);
    clock.advance(Duration.ofSeconds(46));
    restarted().reconcilePending();
    assertThat(billing.get(user, initial.payment().id()).entitlementApplied()).isTrue();
    assertThat(gateway.creates.get()).isEqualTo(1);
  }

  @Test
  void autonomousRestartRecoversLostCreateAndEarlyCallbackWithOriginalKey() {
    gateway.failAfterCreate = true;
    gateway.earlyWebhook =
        () -> {
          gateway.state("succeeded");
          var remote = gateway.payments.values().iterator().next();
          billing.webhook(
              json.read(
                  json.write(
                      Map.of(
                          "type",
                          "notification",
                          "event",
                          "payment.succeeded",
                          "object",
                          remote))));
        };
    var initial = subscribe();
    assertThat(gateway.gets.get()).isZero();
    String request =
        db.queryForObject(
            "SELECT provider_request FROM billing_test_payments WHERE id=?",
            String.class,
            initial.payment().id());
    UUID key =
        db.queryForObject(
            "SELECT provider_key FROM billing_test_payments WHERE id=?",
            UUID.class,
            initial.payment().id());
    gateway.failAfterCreate = false;
    gateway.earlyWebhook = null;
    clock.advance(Duration.ofSeconds(46));
    restarted().reconcilePending();
    assertThat(billing.get(user, initial.payment().id()).entitlementApplied()).isTrue();
    assertThat(gateway.payments).hasSize(1);
    assertThat(gateway.creates.get()).isEqualTo(2);
    assertThat(gateway.payloads.get(key)).isEqualTo(request);
  }

  @Test
  void twoBrowsersDifferentKeysCannotCreateSecondChargeWhileOriginalResponseIsLost()
      throws Exception {
    var gate = new TestGateway.Gate(new CountDownLatch(1), new CountDownLatch(1));
    gateway.createGate.set(gate);
    var intent =
        new CreateSubscription(
            "core-month-subscription-v1", new Consent(true, BillingOffers.CONSENT_VERSION));
    try (var pool = Executors.newSingleThreadExecutor()) {
      var first = pool.submit(() -> billing.createSubscription(user, "browser-one", intent));
      assertThat(gate.entered.await(5, TimeUnit.SECONDS)).isTrue();
      var sameKey = restarted().createSubscription(user, "browser-one", intent);
      assertThat(sameKey.payment().status()).isEqualTo("creating");
      problem(
          () -> restarted().createSubscription(user, "browser-two", intent),
          "billing_purchase_unavailable");
      assertThat(billing.status(user).currentPaymentId()).isEqualTo(sameKey.payment().id());
      gate.release.countDown();
      assertThat(first.get().payment().id()).isEqualTo(sameKey.payment().id());
    }
    assertThat(gateway.creates.get()).isEqualTo(1);
    assertThat(gateway.payments).hasSize(1);
  }

  @Test
  void lateVerifiedCallbackAfterUnknownWindowCreditsWithoutPostAndPreservesCancellation() {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    String candidate = providerId(initial.payment().id());
    gateway.failAfterCreate = false;
    gateway.state("succeeded");
    billing.cancelSubscription(user, initial.subscription().id());
    clock.advance(Duration.ofDays(20));
    restarted().reconcilePending();
    assertThat(billing.get(user, initial.payment().id()).status()).isEqualTo("review_required");
    assertThat(gateway.creates.get()).isEqualTo(1);
    clock.advance(Duration.ofSeconds(6));
    restarted().webhook(callback(initial.payment().id(), candidate));
    assertThat(billing.get(user, initial.payment().id()).entitlementApplied()).isTrue();
    assertThat(billing.subscription(user, initial.subscription().id()).renewalEnabled()).isFalse();
    assertThat(billing.subscription(user, initial.subscription().id()).status())
        .isEqualTo("canceled");
    assertThat(gateway.creates.get()).isEqualTo(1);
    restarted().webhook(callback(initial.payment().id(), candidate));
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_entitlements WHERE payment_id=?",
                Integer.class,
                initial.payment().id()))
        .isEqualTo(1);
  }

  @Test
  void untrustedCallbackLocatorsNeverFetchUnknownUnauthorizedOrMismatchedBinding() {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    String candidate = providerId(initial.payment().id());
    clock.advance(Duration.ofSeconds(6));
    int gets = gateway.gets.get();
    billing.webhook(callback(UUID.randomUUID(), candidate));
    assertThat(gateway.gets.get()).isEqualTo(gets);
    db.update("UPDATE users SET email_verified=false WHERE id=?", user);
    billing.webhook(callback(initial.payment().id(), candidate));
    assertThat(gateway.gets.get()).isEqualTo(gets);
    db.update("UPDATE users SET email_verified=true WHERE id=?", user);
    db.update(
        "UPDATE billing_test_payments SET first_dispatch_at=NULL WHERE id=?",
        initial.payment().id());
    billing.webhook(callback(initial.payment().id(), candidate));
    assertThat(gateway.gets.get()).isEqualTo(gets);
    db.update(
        "UPDATE billing_test_payments SET first_dispatch_at=?,shop_id='999' WHERE id=?",
        java.sql.Timestamp.from(clock.now()),
        initial.payment().id());
    billing.webhook(callback(initial.payment().id(), candidate));
    assertThat(gateway.gets.get()).isEqualTo(gets);
    db.update(
        "UPDATE billing_test_payments SET shop_id='12345',provider_id=? WHERE id=?",
        candidate,
        initial.payment().id());
    billing.webhook(callback(UUID.randomUUID(), candidate));
    assertThat(gateway.gets.get()).isEqualTo(gets);
    billing.webhook(callback(initial.payment().id(), UUID.randomUUID().toString()));
    assertThat(gateway.gets.get()).isEqualTo(gets);
  }

  @Test
  void callbackGetMustMatchCandidateMetadataAmountRecipientAndTestBeforeBinding() {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    String candidate = providerId(initial.payment().id());
    gateway.failAfterCreate = false;
    gateway.state("succeeded");
    var original = gateway.payments.values().iterator().next();
    for (String field : List.of("id", "metadata", "amount", "recipient", "test")) {
      clock.advance(Duration.ofSeconds(6));
      var invalid = (tools.jackson.databind.node.ObjectNode) json.read(original.toString());
      switch (field) {
        case "id" -> invalid.put("id", UUID.randomUUID().toString());
        case "metadata" ->
            invalid.set(
                "metadata",
                json.read(json.write(Map.of("botai_order_id", UUID.randomUUID().toString()))));
        case "amount" ->
            invalid.set("amount", json.read("{\"value\":\"1.00\",\"currency\":\"RUB\"}"));
        case "recipient" -> invalid.set("recipient", json.read("{\"account_id\":\"other-shop\"}"));
        case "test" -> invalid.put("test", false);
      }
      BillingGateway transport =
          new BillingGateway() {
            public JsonNode create(UUID key, String payload) {
              throw new AssertionError("Callback must never POST");
            }

            public JsonNode get(String provider) {
              assertThat(provider).isEqualTo(candidate);
              return invalid;
            }
          };
      problem(
          () -> restarted(transport).webhook(callback(initial.payment().id(), candidate)),
          "billing_verification_failed");
      assertThat(
              db.queryForObject(
                  "SELECT provider_id FROM billing_test_payments WHERE id=?",
                  String.class,
                  initial.payment().id()))
          .isNull();
      assertThat(billing.get(user, initial.payment().id()).status()).isEqualTo("creating");
      assertThat(entitlements.active(user)).isNull();
    }
    clock.advance(Duration.ofSeconds(6));
    restarted().webhook(callback(initial.payment().id(), candidate));
    assertThat(billing.get(user, initial.payment().id()).entitlementApplied()).isTrue();
    assertThat(gateway.creates.get()).isEqualTo(1);
  }

  @Test
  void staleCallbackCannotOverwriteNewBindingAndSuccess() throws Exception {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    gateway.failAfterCreate = false;
    String candidate = providerId(initial.payment().id());
    clock.advance(Duration.ofSeconds(6));
    var gate = new TestGateway.Gate(new CountDownLatch(1), new CountDownLatch(1));
    gateway.nextGate.set(gate);
    try (var pool = Executors.newSingleThreadExecutor()) {
      var old = pool.submit(() -> restarted().webhook(callback(initial.payment().id(), candidate)));
      assertThat(gate.entered.await(5, TimeUnit.SECONDS)).isTrue();
      clock.advance(Duration.ofSeconds(46));
      gateway.state("succeeded");
      restarted().webhook(callback(initial.payment().id(), candidate));
      gate.release.countDown();
      old.get();
    }
    assertThat(billing.get(user, initial.payment().id()).status()).isEqualTo("succeeded");
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_entitlements WHERE payment_id=?",
                Integer.class,
                initial.payment().id()))
        .isEqualTo(1);
    assertThat(gateway.creates.get()).isEqualTo(1);
  }

  @Test
  void recoveredCallbackBindingAndGrantRollbackTogetherThenRecoverWithoutPost() {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    gateway.failAfterCreate = false;
    gateway.state("succeeded");
    String candidate = providerId(initial.payment().id());
    clock.advance(Duration.ofSeconds(6));
    db.execute(
        "CREATE FUNCTION billing_test_abort_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
            + " RAISE EXCEPTION 'simulated apply interruption'; END $$");
    db.execute(
        "CREATE TRIGGER billing_test_abort_grant BEFORE INSERT ON billing_test_entitlements FOR"
            + " EACH ROW EXECUTE FUNCTION billing_test_abort_grant()");
    try {
      assertThatThrownBy(() -> restarted().webhook(callback(initial.payment().id(), candidate)))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
    } finally {
      db.execute("DROP TRIGGER billing_test_abort_grant ON billing_test_entitlements");
      db.execute("DROP FUNCTION billing_test_abort_grant()");
    }
    assertThat(
            db.queryForObject(
                "SELECT provider_id FROM billing_test_payments WHERE id=?",
                String.class,
                initial.payment().id()))
        .isNull();
    assertThat(entitlements.active(user)).isNull();
    clock.advance(Duration.ofSeconds(6));
    restarted().webhook(callback(initial.payment().id(), candidate));
    assertThat(billing.get(user, initial.payment().id()).entitlementApplied()).isTrue();
    assertThat(gateway.creates.get()).isEqualTo(1);
  }

  @Test
  void callbackAndSchedulerConcurrentRecoveryNeverCreatesAnotherLogicalCharge() throws Exception {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    String candidate = providerId(initial.payment().id());
    gateway.failAfterCreate = false;
    gateway.state("succeeded");
    clock.advance(Duration.ofSeconds(6));
    try (var pool = Executors.newFixedThreadPool(3)) {
      var calls =
          pool.invokeAll(
              List.<Callable<Void>>of(
                  () -> {
                    try {
                      restarted().webhook(callback(initial.payment().id(), candidate));
                    } catch (ApiException busy) {
                      assertThat(busy.status()).isEqualTo(503);
                    }
                    return null;
                  },
                  () -> {
                    try {
                      restarted().webhook(callback(initial.payment().id(), candidate));
                    } catch (ApiException busy) {
                      assertThat(busy.status()).isEqualTo(503);
                    }
                    return null;
                  },
                  () -> {
                    restarted().reconcilePending();
                    return null;
                  }));
      for (var call : calls) call.get();
    }
    assertThat(billing.get(user, initial.payment().id()).status()).isEqualTo("succeeded");
    assertThat(gateway.payments).hasSize(1);
    assertThat(gateway.payloads).hasSize(1);
    assertThat(gateway.creates.get()).isBetween(1, 2);
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM billing_test_entitlements WHERE payment_id=?",
                Integer.class,
                initial.payment().id()))
        .isEqualTo(1);
    assertThat(entitlements.active(other)).isNull();
  }

  @Test
  void lateUnboundCallbackBusyOrCooldownMustNotBeAcknowledgedAndLost() {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    gateway.failAfterCreate = false;
    gateway.state("succeeded");
    String candidate = providerId(initial.payment().id());
    clock.advance(Duration.ofHours(24));
    restarted().reconcilePending();
    db.update(
        "UPDATE billing_test_payments SET next_check_at=? WHERE id=?",
        java.sql.Timestamp.from(clock.now().plusSeconds(5)),
        initial.payment().id());
    int gets = gateway.gets.get();
    problem(
        () -> restarted().webhook(callback(initial.payment().id(), candidate)),
        "billing_provider_unavailable");
    assertThat(gateway.gets.get()).isEqualTo(gets);
    clock.advance(Duration.ofSeconds(6));
    db.update(
        "UPDATE billing_test_payments SET lease_token=?,lease_until=? WHERE id=?",
        UUID.randomUUID(),
        java.sql.Timestamp.from(clock.now().plusSeconds(45)),
        initial.payment().id());
    problem(
        () -> restarted().webhook(callback(initial.payment().id(), candidate)),
        "billing_provider_unavailable");
    assertThat(gateway.gets.get()).isEqualTo(gets);
    clock.advance(Duration.ofSeconds(46));
    restarted().webhook(callback(initial.payment().id(), candidate));
    assertThat(billing.get(user, initial.payment().id()).entitlementApplied()).isTrue();
    assertThat(gateway.creates.get()).isEqualTo(1);
  }

  @Test
  void staleUnboundCallbackWithoutDurableBindingRequiresProviderRetry() throws Exception {
    gateway.failAfterCreate = true;
    var initial = subscribe();
    gateway.failAfterCreate = false;
    gateway.state("succeeded");
    String candidate = providerId(initial.payment().id());
    clock.advance(Duration.ofSeconds(6));
    var gate = new TestGateway.Gate(new CountDownLatch(1), new CountDownLatch(1));
    gateway.nextGate.set(gate);
    try (var pool = Executors.newSingleThreadExecutor()) {
      var old = pool.submit(() -> restarted().webhook(callback(initial.payment().id(), candidate)));
      assertThat(gate.entered.await(5, TimeUnit.SECONDS)).isTrue();
      clock.advance(Duration.ofSeconds(46));
      gateway.wrongAmount = true;
      problem(
          () -> restarted().webhook(callback(initial.payment().id(), candidate)),
          "billing_verification_failed");
      gateway.wrongAmount = false;
      gate.release.countDown();
      assertThatThrownBy(old::get)
          .isInstanceOf(ExecutionException.class)
          .cause()
          .isInstanceOf(ApiException.class)
          .extracting("code")
          .isEqualTo("billing_provider_unavailable");
    }
    assertThat(
            db.queryForObject(
                "SELECT provider_id FROM billing_test_payments WHERE id=?",
                String.class,
                initial.payment().id()))
        .isNull();
    clock.advance(Duration.ofSeconds(6));
    restarted().webhook(callback(initial.payment().id(), candidate));
    assertThat(billing.get(user, initial.payment().id()).entitlementApplied()).isTrue();
    assertThat(gateway.creates.get()).isEqualTo(1);
  }
}
