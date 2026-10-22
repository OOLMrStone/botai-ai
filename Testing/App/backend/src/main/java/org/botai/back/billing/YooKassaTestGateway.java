package org.botai.back.billing;

import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.botai.back.common.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class YooKassaTestGateway implements BillingGateway {
  private static final JsonMapper JSON =
      JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
  private final BillingConfig config;
  private final URI base;
  private final HttpClient client =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();

  @Autowired
  public YooKassaTestGateway(BillingConfig config) {
    this(config, URI.create("https://api.yookassa.ru/v3/"));
  }

  // Only package tests can substitute the transport. No runtime URL override exists.
  YooKassaTestGateway(BillingConfig config, URI base) {
    this.config = config;
    this.base = base;
  }

  public JsonNode create(UUID providerKey, String payload) {
    JsonNode me = send("me", null, null);
    if (!me.path("test").isBoolean()
        || !me.path("test").asBoolean()
        || !config.shopId.equals(me.path("account_id").asText())
        || !"enabled".equals(me.path("status").asText())) throw invalid();
    return send("payments", providerKey.toString(), payload);
  }

  public JsonNode get(String id) {
    if (!id.matches("[a-zA-Z0-9-]{1,64}")) throw invalid();
    return send("payments/" + id, null, null);
  }

  private JsonNode send(String path, String key, String payload) {
    if (!config.enabled || TransactionSynchronizationManager.isActualTransactionActive())
      throw unavailable();
    String auth =
        Base64.getEncoder()
            .encodeToString((config.shopId + ":" + config.secret).getBytes(StandardCharsets.UTF_8));
    var request =
        HttpRequest.newBuilder(base.resolve(path))
            .timeout(Duration.ofSeconds(12))
            .header("Authorization", "Basic " + auth)
            .header("Accept", "application/json");
    if (payload == null) request.GET();
    else
      request
          .header("Idempotence-Key", key)
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(payload));
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(12);
    var future = client.sendAsync(request.build(), HttpResponse.BodyHandlers.ofInputStream());
    try {
      var response = future.get(12, TimeUnit.SECONDS);
      try (var body = response.body();
          var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        var read =
            executor.submit(
                () -> {
                  var bytes = body.readNBytes(65537);
                  if (bytes.length > 65536) throw new IOException("Limit");
                  return bytes;
                });
        byte[] bytes;
        try {
          bytes = read.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
        } catch (Exception e) {
          body.close();
          read.cancel(true);
          throw e;
        }
        if (response.statusCode() != 200
            || !response
                .headers()
                .firstValue("Content-Type")
                .orElse("")
                .split(";", 2)[0]
                .equalsIgnoreCase("application/json")) throw unavailable();
        var result = JSON.readTree(bytes);
        if (!result.isObject()) throw invalid();
        return result;
      }
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      future.cancel(true);
      throw unavailable();
    }
  }

  static ApiException unavailable() {
    return new ApiException(
        503,
        "billing_provider_unavailable",
        "Тестовая оплата временно недоступна. Повтори проверку этой же операции");
  }

  static ApiException invalid() {
    return new ApiException(
        502, "billing_verification_failed", "Не удалось подтвердить тестовый платёж");
  }
}
