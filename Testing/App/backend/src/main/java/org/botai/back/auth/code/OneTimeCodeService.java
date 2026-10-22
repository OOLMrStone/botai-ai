package org.botai.back.auth.code;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

/**
 * Issues and verifies one-time email secrets, in two shapes.
 *
 * <p><b>Codes</b> ({@link #issue}) are 6 digits typed back into the app, used
 * where the user is already looking at a form: passwordless login and password
 * reset. Security properties:
 * <ul>
 *   <li>digits come from {@link SecureRandom}, valid for {@link #TTL};</li>
 *   <li>only a salted SHA-256 is stored (the row id is the salt), never the code;</li>
 *   <li>at most {@link #MAX_ATTEMPTS} wrong guesses, then the code is dead -
 *       with the TTL this caps online brute force at 5 guesses per 10 minutes
 *       against a space of 1,000,000.</li>
 * </ul>
 *
 * <p><b>Tokens</b> ({@link #issueToken}) go inside a link the user clicks, so
 * nothing is typed and no guess limit can protect them - they carry their own
 * entropy instead: 256 random bits, valid for {@link #TOKEN_TTL} because people
 * open mail hours later. The format is {@code <row id>.<secret>}: the id half
 * selects the row (and doubles as the hash salt, as with codes) and the secret
 * half is compared in constant time, so a stolen database still yields nothing
 * usable.
 *
 * <p>Common to both: issuing invalidates all previous secrets for the same
 * purpose, and {@link #RESEND_COOLDOWN} applies per user+purpose (anti-spam).
 */
@Service
@RequiredArgsConstructor
public class OneTimeCodeService {

    static final Duration TTL = Duration.ofMinutes(10);
    static final Duration TOKEN_TTL = Duration.ofHours(24);
    static final Duration RESEND_COOLDOWN = Duration.ofSeconds(60);
    static final int MAX_ATTEMPTS = 5;
    private static final int TOKEN_SECRET_BYTES = 32;

    private final OneTimeCodeRepository codeRepository;
    private final SecureRandom random = new SecureRandom();

    /**
     * Creates a fresh code, replacing any previous ones. Returns empty when the
     * cooldown has not elapsed yet - the caller then simply does not send an email.
     */
    @Transactional
    public Optional<String> issue(UUID userId, CodePurpose purpose) {
        if (withinCooldown(userId, purpose)) {
            return Optional.empty();
        }
        codeRepository.deleteByUserIdAndPurpose(userId, purpose);

        UUID id = UUID.randomUUID();
        String code = "%06d".formatted(random.nextInt(1_000_000));
        codeRepository.save(new OneTimeCode(id, userId, purpose, hash(id, code), Instant.now().plus(TTL)));
        return Optional.of(code);
    }

    /**
     * Creates a link token, replacing any previous secret for this purpose.
     * Returns empty while the resend cooldown is still running.
     */
    @Transactional
    public Optional<String> issueToken(UUID userId, CodePurpose purpose) {
        if (withinCooldown(userId, purpose)) {
            return Optional.empty();
        }
        codeRepository.deleteByUserIdAndPurpose(userId, purpose);

        UUID id = UUID.randomUUID();
        byte[] secretBytes = new byte[TOKEN_SECRET_BYTES];
        random.nextBytes(secretBytes);
        String secret = Base64.getUrlEncoder().withoutPadding().encodeToString(secretBytes);
        codeRepository.save(
                new OneTimeCode(id, userId, purpose, hash(id, secret), Instant.now().plus(TOKEN_TTL)));
        return Optional.of(id + "." + secret);
    }

    /**
     * Verifies and consumes a link token, returning the user it belongs to.
     * Every failure mode - malformed, unknown, wrong purpose, expired, already
     * used, wrong secret - is reported the same way: empty.
     */
    @Transactional
    public Optional<UUID> consumeToken(String token, CodePurpose purpose) {
        int separator = token.indexOf('.');
        if (separator <= 0 || separator == token.length() - 1) {
            return Optional.empty();
        }
        UUID id;
        try {
            id = UUID.fromString(token.substring(0, separator));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        String secret = token.substring(separator + 1);

        OneTimeCode candidate = codeRepository.findById(id)
                .filter(c -> c.getPurpose() == purpose)
                .filter(c -> c.getConsumedAt() == null)
                .filter(c -> c.getExpiresAt().isAfter(Instant.now()))
                .orElse(null);
        if (candidate == null) {
            return Optional.empty();
        }

        byte[] expected = candidate.getCodeHash().getBytes(StandardCharsets.UTF_8);
        byte[] actual = hash(id, secret).getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            return Optional.empty();
        }

        candidate.setConsumedAt(Instant.now());
        return Optional.of(candidate.getUserId());
    }

    /** Verifies and consumes the code; a consumed code can never be used again. */
    @Transactional
    public boolean consume(UUID userId, CodePurpose purpose, String code) {
        OneTimeCode candidate = codeRepository
                .findTopByUserIdAndPurposeOrderByCreatedAtDesc(userId, purpose)
                .filter(c -> c.getConsumedAt() == null)
                .filter(c -> c.getExpiresAt().isAfter(Instant.now()))
                .filter(c -> c.getAttempts() < MAX_ATTEMPTS)
                .orElse(null);
        if (candidate == null) {
            return false;
        }

        byte[] expected = candidate.getCodeHash().getBytes(StandardCharsets.UTF_8);
        byte[] actual = hash(candidate.getId(), code).getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            candidate.setAttempts(candidate.getAttempts() + 1);
            return false;
        }

        candidate.setConsumedAt(Instant.now());
        return true;
    }

    private boolean withinCooldown(UUID userId, CodePurpose purpose) {
        return codeRepository.findTopByUserIdAndPurposeOrderByCreatedAtDesc(userId, purpose)
                .filter(c -> c.getCreatedAt().plus(RESEND_COOLDOWN).isAfter(Instant.now()))
                .isPresent();
    }

    private static String hash(UUID salt, String code) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest((salt + ":" + code).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
