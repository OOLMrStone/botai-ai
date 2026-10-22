package org.botai.back.billing;

import java.net.URI;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** No live billing mode exists. Deliberately not a record: never stringify credentials. */
@Component
public class BillingConfig {
  final boolean enabled;
  final String shopId, secret, origin;
  final Set<String> accounts;

  public BillingConfig(
      @Value("${app.billing.mode:disabled}") String mode,
      @Value("${app.billing.sandbox-database:}") String database,
      @Value("${app.billing.shop-id:}") String shopId,
      @Value("${app.billing.secret-key:}") String secret,
      @Value("${app.billing.return-origin:}") String origin,
      @Value("${app.billing.test-accounts:}") String accounts,
      JdbcTemplate db) {
    if (!Set.of("disabled", "test").contains(mode)) throw invalid();
    this.enabled = mode.equals("test");
    this.shopId = shopId;
    this.secret = secret;
    this.origin = origin;
    this.accounts =
        Set.copyOf(
            Arrays.stream(accounts.split(","))
                .map(String::strip)
                .filter(s -> !s.isEmpty())
                .map(s -> s.toLowerCase(Locale.ROOT))
                .toList());
    if (!enabled) return;
    if (!database.matches("[a-z][a-z0-9_]*_payments_test")
        || !database.equals(db.queryForObject("SELECT current_database()", String.class))
        || !shopId.matches("[0-9]{1,32}")
        || !secret.startsWith("test_")
        || secret.length() < 12
        || secret.contains("\n")
        || secret.contains("\r")
        || this.accounts.isEmpty()) throw invalid();
    try {
      URI uri = URI.create(origin);
      boolean local = Set.of("localhost", "127.0.0.1", "[::1]").contains(uri.getHost());
      if (!("https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && local))
          || uri.getHost() == null
          || uri.getUserInfo() != null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || !uri.getPath().isEmpty()) throw invalid();
    } catch (IllegalArgumentException e) {
      throw invalid();
    }
  }

  public boolean enabled() {
    return enabled;
  }

  public boolean permits(String email) {
    return enabled && accounts.contains(email.toLowerCase(Locale.ROOT));
  }

  private static IllegalStateException invalid() {
    return new IllegalStateException(
        "Test billing requires an isolated payments_test database and valid sandbox configuration");
  }
}
