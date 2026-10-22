package org.botai.back.billing;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.*;

public final class BillingDtos {
  private BillingDtos() {}

  public record Amount(String value, String currency) {}

  public record Offer(
      String id,
      String kind,
      String plan,
      String period,
      Amount amount,
      int checkLimit,
      Integer durationDays,
      Instant expiresAt,
      boolean autoRenew,
      Integer intervalDays,
      String consentVersion) {}

  public record Offers(String mode, boolean testOnly, List<Offer> offers) {}

  public record Create(@NotBlank @Size(max = 64) String offerId) {}

  public record Consent(boolean accepted, @Size(max = 64) String version) {}

  public record CreateSubscription(
      @NotBlank @Size(max = 64) String offerId, @Valid Consent consent) {}

  public record SubscriptionCreated(Subscription subscription, Payment payment) {}

  public record Payment(
      UUID id,
      String offerId,
      Offer offer,
      String status,
      Amount amount,
      boolean test,
      String confirmationUrl,
      boolean entitlementApplied,
      Instant createdAt,
      String cancellationReason,
      String purpose,
      UUID subscriptionId,
      Integer periodSequence) {}

  public record Entitlement(
      String plan,
      Instant startsAt,
      Instant expiresAt,
      int checksTotal,
      int checksUsed,
      int checksReserved,
      int checksRemaining) {}

  public record Period(
      int sequence,
      Instant startsAt,
      Instant expiresAt,
      int checksTotal,
      int checksUsed,
      int checksReserved,
      int checksRemaining) {}

  public record Subscription(
      UUID id,
      String status,
      boolean renewalEnabled,
      Offer offer,
      Period currentPeriod,
      Instant nextPaymentAt,
      Instant paidThrough,
      UUID currentPaymentId,
      UUID inFlightPaymentId,
      String actionRequired) {}

  public record Status(
      String mode,
      boolean testOnly,
      Entitlement entitlement,
      boolean canPurchase,
      UUID currentPaymentId,
      Subscription subscription) {}
}
