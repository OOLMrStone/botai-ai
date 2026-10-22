package org.botai.back.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.botai.back.auth.dto.EmailRequest;
import org.botai.back.auth.dto.EmailVerificationRequest;
import org.botai.back.auth.dto.LoginRequest;
import org.botai.back.auth.dto.OtpLoginRequest;
import org.botai.back.auth.dto.PasswordResetRequest;
import org.botai.back.auth.dto.RegisterRequest;
import org.botai.back.auth.dto.UserResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /**
     * CSRF bootstrap for the SPA: calling this endpoint sets the XSRF-TOKEN
     * cookie (and returns the token) so subsequent POSTs can pass it back in
     * the X-XSRF-TOKEN header.
     */
    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserResponse register(@Valid @RequestBody RegisterRequest request) {
        return UserResponse.from(authService.register(request));
    }

    @PostMapping("/login")
    public UserResponse login(@Valid @RequestBody LoginRequest request,
                              HttpServletRequest servletRequest,
                              HttpServletResponse servletResponse) {
        return UserResponse.from(authService.login(request, servletRequest, servletResponse));
    }

    /**
     * Emails a one-time login code. Always 202: whether the account exists is
     * deliberately not revealed.
     */
    @PostMapping("/otp/request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void requestLoginCode(@Valid @RequestBody EmailRequest request) {
        authService.requestLoginCode(request.email());
    }

    /** Passwordless login with the emailed code; sets the session cookie. */
    @PostMapping("/otp/login")
    public UserResponse otpLogin(@Valid @RequestBody OtpLoginRequest request,
                                 HttpServletRequest servletRequest,
                                 HttpServletResponse servletResponse) {
        return UserResponse.from(authService.otpLogin(request, servletRequest, servletResponse));
    }

    /**
     * Re-sends the verification link (registration sends one automatically).
     * Always 202 - neither account existence nor verification status leaks.
     */
    @PostMapping("/email/verify-request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void requestEmailVerification(@Valid @RequestBody EmailRequest request) {
        authService.requestEmailVerification(request.email());
    }

    /**
     * Confirms the address. The emailed link opens the SPA, which posts the
     * token here; a plain GET link would be "clicked" by mail scanners and
     * link-preview bots, burning the token before the user ever sees it.
     */
    @PostMapping("/email/verify")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void verifyEmail(@Valid @RequestBody EmailVerificationRequest request) {
        authService.verifyEmail(request.token());
    }

    /** Emails a password-reset code. Same 202-always contract as /otp/request. */
    @PostMapping("/password/reset-request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void requestPasswordReset(@Valid @RequestBody EmailRequest request) {
        authService.requestPasswordResetCode(request.email());
    }

    /** Sets the new password and invalidates every session of the account. */
    @PostMapping("/password/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPassword(@Valid @RequestBody PasswordResetRequest request) {
        authService.resetPassword(request);
    }

    /** Who am I — lets the frontend restore UI state from the session cookie. */
    @GetMapping("/me")
    public UserResponse me(Authentication authentication) {
        return UserResponse.from(authService.currentUser(authentication));
    }

    @GetMapping("/session/verified")
    public void verifiedSession(Authentication authentication) {
        if (!authService.currentUser(authentication).isEmailVerified()) {
            throw new org.botai.back.common.ApiException(403,"email_unverified","Подтверди email");
        }
    }

    // POST /api/auth/logout is handled by Spring Security's logout filter
    // (see SecurityConfig): invalidates the session and deletes the cookie.
}
