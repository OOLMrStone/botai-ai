package org.botai.back.billing;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.botai.back.common.ApiException;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;

class YooKassaTestGatewayTest {
  HttpServer server;
  YooKassaTestGateway gateway;
  AtomicInteger posts;
  volatile String me;
  volatile int meStatus;

  @BeforeEach
  void setup() throws Exception {
    var db = mock(JdbcTemplate.class);
    when(db.queryForObject("SELECT current_database()", String.class))
        .thenReturn("unit_payments_test");
    var config =
        new BillingConfig(
            "test",
            "unit_payments_test",
            "12345",
            "test_fixture_only",
            "http://localhost:13002",
            "test@example.test",
            db);
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    posts = new AtomicInteger();
    me = "{\"account_id\":\"12345\",\"test\":true,\"status\":\"enabled\"}";
    meStatus = 200;
    server.createContext(
        "/v3/me",
        e -> {
          e.getResponseHeaders().set("Content-Type", "application/json");
          byte[] body = me.getBytes(StandardCharsets.UTF_8);
          e.sendResponseHeaders(meStatus, body.length);
          e.getResponseBody().write(body);
          e.close();
        });
    server.createContext(
        "/v3/payments",
        e -> {
          posts.incrementAndGet();
          e.getResponseHeaders().set("Content-Type", "application/json");
          byte[] body = "{\"id\":\"fixture\"}".getBytes(StandardCharsets.UTF_8);
          e.sendResponseHeaders(200, body.length);
          e.getResponseBody().write(body);
          e.close();
        });
    server.start();
    gateway =
        new YooKassaTestGateway(
            config, URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v3/"));
  }

  @AfterEach
  void close() {
    server.stop(0);
  }

  @Test
  void providerPostRequiresMatchingEnabledTestShopEveryTime() {
    assertThat(gateway.create(UUID.randomUUID(), "{}").path("id").asText()).isEqualTo("fixture");
    assertThat(posts).hasValue(1);
    for (String body :
        new String[] {
          "{\"account_id\":\"12345\",\"test\":false,\"status\":\"enabled\"}",
          "{\"account_id\":\"other\",\"test\":true,\"status\":\"enabled\"}",
          "{\"account_id\":\"12345\",\"test\":true,\"status\":\"disabled\"}",
          "{\"account_id\":\"12345\",\"test\":\"true\",\"status\":\"enabled\"}"
        }) {
      me = body;
      assertThatThrownBy(() -> gateway.create(UUID.randomUUID(), "{}"))
          .isInstanceOf(ApiException.class);
      assertThat(posts).hasValue(1);
    }
  }

  @Test
  void failedRedirectDuplicateOrOversizedMeNeverPosts() {
    for (int status : new int[] {401, 302, 500}) {
      meStatus = status;
      assertThatThrownBy(() -> gateway.create(UUID.randomUUID(), "{}"))
          .isInstanceOf(ApiException.class);
    }
    meStatus = 200;
    for (String body : new String[] {"{\"test\":true,\"test\":false}", "x".repeat(65537)}) {
      me = body;
      assertThatThrownBy(() -> gateway.create(UUID.randomUUID(), "{}"))
          .isInstanceOf(ApiException.class);
    }
    assertThat(posts).hasValue(0);
  }

  @Test
  void confirmationRedirectRejectsArbitraryHostsPortsSchemesAndCredentials() {
    assertThat(BillingService.confirmationUrl("https://yoomoney.ru/checkout?id=fixture"))
        .startsWith("https:");
    for (String value :
        new String[] {
          "https://yoomoney.ru.evil.test/",
          "https://evil.test/",
          "http://yoomoney.ru/",
          "https://attacker@yoomoney.ru/",
          "https://yoomoney.ru:8443/",
          "javascript:alert(1)",
          "/relative"
        })
      assertThatThrownBy(() -> BillingService.confirmationUrl(value))
          .isInstanceOf(ApiException.class);
  }

  @Test
  void configurationRejectsProductionDatabaseAndLiveModeWithoutEchoingSecrets() {
    var db = mock(JdbcTemplate.class);
    when(db.queryForObject("SELECT current_database()", String.class)).thenReturn("production");
    assertThatThrownBy(
            () ->
                new BillingConfig(
                    "test",
                    "fixture_payments_test",
                    "12345",
                    "live-private-value",
                    "https://example.test",
                    "test@example.test",
                    db))
        .hasMessageNotContaining("live-private-value");
    assertThatThrownBy(() -> new BillingConfig("live", "", "", "", "", "", db))
        .isInstanceOf(IllegalStateException.class);
    assertThat(new BillingConfig("disabled", "", "", "", "", "", db).enabled()).isFalse();
  }
}
