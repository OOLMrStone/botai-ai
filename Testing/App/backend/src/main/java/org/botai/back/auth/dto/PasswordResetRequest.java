package org.botai.back.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record PasswordResetRequest(
        @NotBlank @Email @Size(max = 320) String email,
        @NotBlank @Pattern(regexp = "\\d{6}") String code,
        // Same bounds as registration (72 bytes = BCrypt input limit).
        @NotBlank @Size(min = 8, max = 72) String newPassword
) {
}
