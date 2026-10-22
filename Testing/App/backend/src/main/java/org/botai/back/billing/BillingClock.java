package org.botai.back.billing;

import java.time.Instant;
import org.springframework.stereotype.Component;

@Component
public class BillingClock {
  public Instant now() {
    return Instant.now();
  }
}
