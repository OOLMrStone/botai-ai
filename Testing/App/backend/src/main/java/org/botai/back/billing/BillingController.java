package org.botai.back.billing;

import static org.botai.back.billing.BillingDtos.*;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.botai.back.security.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/billing")
public class BillingController {
  private final BillingService billing;
  private final CurrentActor actors;
  private final RateLimits limits;

  public BillingController(BillingService billing, CurrentActor actors, RateLimits limits) {
    this.billing = billing;
    this.actors = actors;
    this.limits = limits;
  }

  @GetMapping("/offers")
  public Offers offers(Authentication auth) {
    return billing.offers(actors.require(auth).getId());
  }

  @GetMapping("/status")
  public Status status(Authentication auth) {
    return billing.status(actors.require(auth).getId());
  }

  @PostMapping("/payments")
  public Payment create(
      Authentication auth,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Create input) {
    UUID user = actors.require(auth).getId();
    limits.check("billing-create", user.toString(), 30, 3600);
    return billing.create(user, key, input);
  }

  @GetMapping("/payments/{id}")
  public Payment get(Authentication auth, @PathVariable UUID id) {
    return billing.get(actors.require(auth).getId(), id);
  }

  @PostMapping("/payments/{id}/refresh")
  public Payment refresh(Authentication auth, @PathVariable UUID id) {
    UUID user = actors.require(auth).getId();
    limits.check("billing-refresh", user.toString(), 300, 3600);
    return billing.refresh(user, id);
  }

  @PostMapping("/subscriptions")
  public SubscriptionCreated subscribe(
      Authentication auth,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody CreateSubscription input) {
    UUID user = actors.require(auth).getId();
    limits.check("billing-create", user.toString(), 30, 3600);
    return billing.createSubscription(user, key, input);
  }

  @GetMapping("/subscriptions/{id}")
  public Subscription subscription(Authentication auth, @PathVariable UUID id) {
    return billing.subscription(actors.require(auth).getId(), id);
  }

  @PostMapping("/subscriptions/{id}/cancel")
  public Subscription cancel(Authentication auth, @PathVariable UUID id) {
    UUID user = actors.require(auth).getId();
    limits.check("billing-cancel", user.toString(), 60, 3600);
    return billing.cancelSubscription(user, id);
  }

  @PostMapping("/yookassa/test/webhook")
  public void webhook(HttpServletRequest request, @RequestBody JsonNode body) {
    limits.check("billing-webhook-global", "all", 600, 60);
    limits.check("billing-webhook-ip", request.getRemoteAddr(), 120, 60);
    billing.webhook(body);
  }
}
