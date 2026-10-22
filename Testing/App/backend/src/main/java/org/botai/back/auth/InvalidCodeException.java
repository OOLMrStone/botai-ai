package org.botai.back.auth;

import org.springframework.security.authentication.BadCredentialsException;

/**
 * Wrong, expired, or already-used one-time code. The message is the same for
 * "no such account" - the code endpoints must not reveal account existence.
 */
public class InvalidCodeException extends BadCredentialsException {

    public InvalidCodeException() {
        this("Invalid or expired code");
    }

    public InvalidCodeException(String message) {
        super(message);
    }
}
