package org.botai.back.mail;

import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;

/**
 * Outgoing transactional email. Sending is {@link Async} for two reasons:
 * the API response does not wait for SMTP, and the response time of
 * "request a code" stays identical whether or not an email was actually sent
 * (no account enumeration via timing).
 *
 * <p>Every message goes out as multipart/alternative - plain text plus HTML.
 * Text-only clients stay readable, and a message that carries both parts is
 * far less likely to be scored as spam than an HTML-only one.
 *
 * <p>One-time codes deliberately never appear in the subject line: subjects
 * show up in lock-screen notifications and inbox previews, where a shoulder
 * surfer could read the code without unlocking the device.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailService {

    private final JavaMailSender mailSender;

    /** Qualified: the web layer's auto-configured engine is a separate bean. */
    @Qualifier("mailTemplateEngine")
    private final TemplateEngine mailTemplateEngine;

    @Value("${app.mail.from}")
    private String from;

    @Async
    public void sendLoginCode(String to, String code) {
        send(to, "Код для входа в botai", "mail/login-code", Map.of("code", code));
    }

    @Async
    public void sendPasswordResetCode(String to, String code) {
        send(to, "Сброс пароля в botai", "mail/password-reset", Map.of("code", code));
    }

    @Async
    public void sendEmailVerificationLink(String to, String verifyUrl) {
        send(to, "Подтверждение почты в botai", "mail/email-verify", Map.of("verifyUrl", verifyUrl));
    }

    private void send(String to, String subject, String template, Map<String, Object> variables) {
        try {
            Context context = new Context(Locale.of("ru"), variables);
            String text = mailTemplateEngine.process(template + ".txt", context);
            String html = mailTemplateEngine.process(template + ".html", context);

            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper =
                    new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            helper.setFrom(from);
            helper.setTo(to);
            helper.setSubject(subject);
            // Order matters: the HTML part must come last for clients to prefer it.
            helper.setText(text, html);

            // Keep vacation responders and other robots from replying to us.
            message.setHeader("Auto-Submitted", "auto-generated");
            message.setHeader("X-Auto-Response-Suppress", "All");

            mailSender.send(message);
        } catch (Exception e) {
            // Runs on the async executor: nothing to propagate to, so log loudly.
            // The code itself is never logged.
            log.error("Failed to send email '{}' to {}", subject, to, e);
        }
    }
}
