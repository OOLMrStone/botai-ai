package org.botai.back.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** The token lifted from the {@code ?token=} query parameter of the emailed link. */
public record EmailVerificationRequest(
        @NotBlank @Size(max = 200) String token
) {
}
