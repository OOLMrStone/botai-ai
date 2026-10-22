package org.botai.back.billing;

import java.util.UUID;
import org.botai.back.common.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Private one-shot QA. No HTTP server, scheduler, migrations or application context. */
public final class BillingEarlyRenewalOnly {
  private BillingEarlyRenewalOnly() {}

  public static void main(String[] args) {
    try {
      if (args.length != 1 || !"yes".equals(System.getenv("APP_BILLING_QA_EARLY_RENEWAL")))
        throw new IllegalArgumentException();
      UUID id = UUID.fromString(args[0]);
      var source =
          new DriverManagerDataSource(
              required("SPRING_DATASOURCE_URL"),
              required("SPRING_DATASOURCE_USERNAME"),
              required("SPRING_DATASOURCE_PASSWORD"));
      var db = new JdbcTemplate(source);
      var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
      var config =
          new BillingConfig(
              required("APP_BILLING_MODE"),
              required("APP_BILLING_SANDBOX_DATABASE"),
              required("APP_BILLING_SHOP_ID"),
              required("APP_BILLING_SECRET_KEY"),
              required("APP_BILLING_RETURN_ORIGIN"),
              required("APP_BILLING_TEST_ACCOUNTS"),
              db);
      if (!config.enabled()) throw new IllegalArgumentException();
      var clock = new BillingClock();
      var billing =
          new BillingService(
              db,
              tx,
              config,
              clock,
              new YooKassaTestGateway(config),
              new BillingEntitlements(db, config, clock),
              new JsonCodec(JsonMapper.builder().build()),
              false);
      var payment = billing.earlyQaRenewal(id);
      System.out.println("TEST_RENEWAL payment=" + payment.id() + " status=" + payment.status());
    } catch (Exception | LinkageError e) {
      System.err.println(
          "TEST_RENEWAL_FAILED configuration_or_operation; inspect owned payment status");
      System.exit(1);
    }
  }

  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) throw new IllegalArgumentException();
    return value;
  }
}
