package org.botai.back.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank @Email @Size(max = 320) String email,
        // 72 bytes is the BCrypt input limit; longer passwords would be silently truncated.
        @NotBlank @Size(min = 8, max = 72) String password,
        @Size(max = 100) String displayName
) {
}
