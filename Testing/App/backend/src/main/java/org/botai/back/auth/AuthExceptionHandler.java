package org.botai.back.auth;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class AuthExceptionHandler {

    @ExceptionHandler(EmailAlreadyUsedException.class)
    public ProblemDetail handleEmailTaken(EmailAlreadyUsedException ex) {
        return org.botai.back.common.ApiProblems.of(409,"email_in_use","Этот email уже используется");
    }

    /** Wrong/expired one-time code (or unknown account - indistinguishable on purpose). */
    @ExceptionHandler(InvalidCodeException.class)
    public ProblemDetail handleInvalidCode(InvalidCodeException ex) {
        return org.botai.back.common.ApiProblems.of(401,"invalid_code",ex.getMessage());
    }

    /**
     * Covers BadCredentialsException, DisabledException, etc. from the login
     * endpoint. The message is deliberately generic: revealing whether the email
     * exists would enable account enumeration.
     */
    @ExceptionHandler(AuthenticationException.class)
    public ProblemDetail handleAuthenticationFailure(AuthenticationException ex) {
        return org.botai.back.common.ApiProblems.of(401,"invalid_credentials","Invalid email or password");
    }
}
