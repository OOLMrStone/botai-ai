package org.botai.back.mail;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.mail.autoconfigure.MailProperties;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Fails startup when the "gmail" profile is active but no app password was
 * supplied.
 *
 * <p>Without this the application starts happily: Boot's binder leaves an
 * unresolvable {@code ${GMAIL_APP_PASSWORD}} placeholder in place as literal
 * text, and the misconfiguration would only surface later as an SMTP auth
 * failure on a background thread - i.e. as users silently never receiving
 * their recovery codes. Better to refuse to start.
 */
@Component
@Profile("gmail")
@RequiredArgsConstructor
class GmailConfigurationCheck implements InitializingBean {

    private final MailProperties mailProperties;

    @Override
    public void afterPropertiesSet() {
        String password = mailProperties.getPassword();
        if (!StringUtils.hasText(password) || password.startsWith("${")) {
            throw new IllegalStateException("""
                    The "gmail" profile is active but GMAIL_APP_PASSWORD is not set.
                    Create a Google app password (https://myaccount.google.com/apppasswords,
                    requires 2-Step Verification) and start with:
                      GMAIL_APP_PASSWORD=... SPRING_PROFILES_ACTIVE=gmail ./gradlew bootRun""");
        }
    }
}
