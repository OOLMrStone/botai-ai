package org.botai.back.billing;

import static org.botai.back.billing.BillingDtos.*;

import java.time.Instant;
import java.util.*;
import org.botai.back.common.ApiException;

public final class BillingOffers {
  private BillingOffers() {}

  static final String CONSENT_VERSION = "test-recurring-v1";

  // Immutable versioned canonical consent. Price and quota placeholders are bound to the payment
  // snapshot.
  static String consentText(Offer o) {
    return "BotAI test-recurring-v1: согласен сохранить способ оплаты и автоматически оплачивать"
               + " тариф "
        + o.plan()
        + " по "
        + o.amount().value()
        + " RUB каждые 30 суток за "
        + o.checkLimit()
        + " проверок. Цена фиксирована; без переноса проверок. Отмена будущих платежей в личном"
        + " кабинете сохраняет оплаченный срок; уже начатый платёж может завершиться. После отказа"
        + " новых автоматических попыток нет.";
  }

  static final Instant SEASON_END = Instant.parse("2027-06-10T21:00:00Z");
  static final List<Offer> ALL =
      List.of(
          offer("light", "month", 299, 30),
          offer("core", "month", 699, 70),
          offer("heavy", "month", 899, 110),
          offer("light", "season", 1499, 240),
          offer("core", "season", 3499, 560),
          offer("heavy", "season", 4999, 880));

  private static Offer offer(String plan, String period, int rubles, int checks) {
    boolean sub = period.equals("month");
    return new Offer(
        plan + "-" + period + (sub ? "-subscription-v1" : "-v1"),
        sub ? "subscription" : "one_time",
        plan,
        period,
        new Amount(rubles + ".00", "RUB"),
        checks,
        sub ? 30 : null,
        sub ? null : SEASON_END,
        sub,
        sub ? 30 : null,
        sub ? CONSENT_VERSION : null);
  }

  static List<Offer> available(Instant now) {
    return ALL.stream().filter(o -> o.expiresAt() == null || o.expiresAt().isAfter(now)).toList();
  }

  static Offer find(String id, Instant now) {
    return available(now).stream()
        .filter(o -> o.id().equals(id))
        .findFirst()
        .orElseThrow(() -> ApiException.invalid("Неизвестное тестовое предложение"));
  }
}
