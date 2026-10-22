package org.botai.back.auth;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.botai.back.auth.code.CodePurpose;
import org.botai.back.auth.code.OneTimeCodeService;
import org.botai.back.auth.dto.LoginRequest;
import org.botai.back.auth.dto.OtpLoginRequest;
import org.botai.back.auth.dto.PasswordResetRequest;
import org.botai.back.auth.dto.RegisterRequest;
import org.botai.back.mail.EmailService;
import org.botai.back.user.User;
import org.botai.back.user.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final org.botai.back.security.CurrentActor currentActor;
    private final PasswordEncoder passwordEncoder;
    private final org.botai.back.security.RateLimits rateLimits;
    private final org.springframework.security.web.authentication.session.SessionAuthenticationStrategy sessionAuthenticationStrategy;
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;
    private final OneTimeCodeService oneTimeCodeService;
    private final EmailService emailService;
    private final FindByIndexNameSessionRepository<? extends Session> sessionRepository;
    private final MeterRegistry meterRegistry;

    /** Where the verification link points - the SPA, not this API (see the controller). */
    @Value("${app.frontend.base-url}")
    private String frontendBaseUrl;

    private final SecurityContextHolderStrategy securityContextHolderStrategy =
            SecurityContextHolder.getContextHolderStrategy();

    @Transactional
    public User register(RegisterRequest request) {
        String email = normalize(request.email());
        org.botai.back.security.PasswordRules.validate(request.password());
        rateLimits.check("register-account", email, 5, 3600);
        if (userRepository.existsByEmail(email)) {
            throw new EmailAlreadyUsedException(email);
        }
        User user = User.builder()
                .email(email)
                .passwordHash(passwordEncoder.encode(request.password()))
                .displayName(request.displayName())
                .build();
        User saved = userRepository.save(user);
        meterRegistry.counter("auth.registrations", "provider", "local").increment();
        sendVerificationLink(saved);
        return saved;
    }

    /**
     * Re-sends the verification link. Like the other code endpoints this is
     * silent about whether the account exists - and it also stays silent for an
     * already-verified address, so the endpoint cannot be used to probe which
     * addresses are confirmed.
     */
    @Transactional
    public void requestEmailVerification(String email) {
        enabledUserByEmail(email)
                .filter(user -> !user.isEmailVerified())
                .ifPresent(this::sendVerificationLink);
    }

    /**
     * Consumes the token from the emailed link and marks the address verified.
     * Deliberately not tied to a session: people open mail wherever they like,
     * and the token itself is the proof of ownership.
     */
    @Transactional
    public void verifyEmail(String token) {
        UUID userId = oneTimeCodeService.consumeToken(token, CodePurpose.EMAIL_VERIFICATION)
                .orElseThrow(() -> new InvalidCodeException("Invalid or expired verification link"));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new InvalidCodeException("Invalid or expired verification link"));

        if (!user.isEmailVerified()) {
            user.setEmailVerified(true);
            meterRegistry.counter("auth.email.verifications").increment();
        }
    }

    private void sendVerificationLink(User user) {
        oneTimeCodeService.issueToken(user.getId(), CodePurpose.EMAIL_VERIFICATION).ifPresent(token -> {
            String url = frontendBaseUrl + "/verify-email?token="
                    + URLEncoder.encode(token, StandardCharsets.UTF_8);
            afterCommit(() -> emailService.sendEmailVerificationLink(user.getEmail(), url));
            meterRegistry.counter("auth.codes.issued", "purpose", "email_verification").increment();
        });
    }

    /**
     * Verifies credentials and establishes the session: the SecurityContext is
     * written to the HTTP session, which Spring Session persists in Postgres.
     * The browser only ever holds the opaque SESSION cookie.
     */
    public User login(LoginRequest request, HttpServletRequest servletRequest,
                      HttpServletResponse servletResponse) {
        org.botai.back.security.PasswordRules.validate(request.password());
        rateLimits.check("login-account", normalize(request.email()), 10, 60);
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(
                            normalize(request.email()), request.password()));
        } catch (AuthenticationException e) {
            meterRegistry.counter("auth.logins", "method", "password", "result", "failure").increment();
            throw e;
        }
        meterRegistry.counter("auth.logins", "method", "password", "result", "success").increment();

        establishSession(authentication, servletRequest, servletResponse);
        return currentUser(authentication);
    }

    /**
     * Emails a one-time login code. Always succeeds from the caller's point of
     * view: for unknown or disabled accounts nothing is sent, but the response
     * is identical (no account enumeration).
     */
    @Transactional
    public void requestLoginCode(String email) {
        requestCode(email, CodePurpose.LOGIN, "login");
    }

    @Transactional
    public void requestPasswordResetCode(String email) {
        requestCode(email, CodePurpose.PASSWORD_RESET, "password_reset");
    }

    /** Passwordless login: a valid emailed code plays the role of the password. */
    public User otpLogin(OtpLoginRequest request, HttpServletRequest servletRequest,
                         HttpServletResponse servletResponse) {
        User user = enabledUserByEmail(request.email())
                .filter(u -> oneTimeCodeService.consume(u.getId(), CodePurpose.LOGIN, request.code()))
                .orElse(null);
        if (user == null) {
            meterRegistry.counter("auth.logins", "method", "otp", "result", "failure").increment();
            throw new InvalidCodeException();
        }
        meterRegistry.counter("auth.logins", "method", "otp", "result", "success").increment();

        Authentication authentication = UsernamePasswordAuthenticationToken.authenticated(
                user.getEmail(), null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name())));
        establishSession(authentication, servletRequest, servletResponse);
        return user;
    }

    /**
     * Sets a new password after verifying the emailed code, then kills every
     * existing session of the account - a stolen session must not survive a
     * password reset.
     */
    @Transactional
    public void resetPassword(PasswordResetRequest request) {
        org.botai.back.security.PasswordRules.validate(request.newPassword());
        User user = enabledUserByEmail(request.email())
                .filter(u -> oneTimeCodeService.consume(u.getId(), CodePurpose.PASSWORD_RESET, request.code()))
                .orElseThrow(InvalidCodeException::new);

        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));

        sessionRepository.findByPrincipalName(user.getEmail())
                .keySet()
                .forEach(sessionRepository::deleteById);

        meterRegistry.counter("auth.password.resets").increment();
    }

    public User currentUser(Authentication authentication) {
        return currentActor.require(authentication);
    }

    private void requestCode(String email, CodePurpose purpose, String metricTag) {
        enabledUserByEmail(email).ifPresent(user ->
                oneTimeCodeService.issue(user.getId(), purpose).ifPresent(code -> {
                    afterCommit(() -> {
                        if (purpose == CodePurpose.LOGIN) {
                            emailService.sendLoginCode(user.getEmail(), code);
                        } else {
                            emailService.sendPasswordResetCode(user.getEmail(), code);
                        }
                    });
                    meterRegistry.counter("auth.codes.issued", "purpose", metricTag).increment();
                }));
    }

    /**
     * Defers the (async) send until the surrounding transaction commits: a code
     * row that never lands in the database must not produce an email, and the
     * recipient must never be able to use a secret before it is readable.
     */
    private void afterCommit(Runnable send) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            send.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                send.run();
            }
        });
    }

    private Optional<User> enabledUserByEmail(String email) {
        return userRepository.findByEmail(normalize(email)).filter(User::isEnabled);
    }

    private void establishSession(Authentication authentication, HttpServletRequest servletRequest,
                                  HttpServletResponse servletResponse) {
        // Rotate the session id so any session established before login cannot be
        // reused by an attacker who planted it (session fixation).
        sessionAuthenticationStrategy.onAuthentication(authentication, servletRequest, servletResponse);

        SecurityContext context = securityContextHolderStrategy.createEmptyContext();
        context.setAuthentication(authentication);
        securityContextHolderStrategy.setContext(context);
        securityContextRepository.saveContext(context, servletRequest, servletResponse);
    }

    private static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
