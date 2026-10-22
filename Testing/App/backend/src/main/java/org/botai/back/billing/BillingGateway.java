package org.botai.back.billing;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public interface BillingGateway {
  /** Must verify GET /me test=true and matching account before sending POST. */
  JsonNode create(UUID providerKey, String immutablePayload);

  JsonNode get(String providerId);
}
