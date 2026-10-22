package org.botai.back.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
        @NotBlank @jakarta.validation.constraints.Size(max=320) String email,
        @NotBlank @jakarta.validation.constraints.Size(max=72) String password
) {
}
