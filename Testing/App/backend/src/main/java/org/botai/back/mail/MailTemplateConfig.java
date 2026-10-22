package org.botai.back.mail;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * A template engine dedicated to email, separate from anything the web layer
 * might use. Every message is rendered twice - HTML for readable clients and
 * plain text as the alternative part - so templates are addressed by their full
 * name ({@code mail/login-code.html} / {@code mail/login-code.txt}) and each
 * resolver claims one extension.
 */
@Configuration
public class MailTemplateConfig {

    // SpringTemplateEngine, not the bare TemplateEngine: expressions are then
    // evaluated with SpringEL, which the Boot starter ships (the standalone
    // engine expects OGNL, which it does not).
    @Bean
    TemplateEngine mailTemplateEngine() {
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.addTemplateResolver(resolver(TemplateMode.HTML, "*.html", 1));
        engine.addTemplateResolver(resolver(TemplateMode.TEXT, "*.txt", 2));
        return engine;
    }

    private static ClassLoaderTemplateResolver resolver(TemplateMode mode, String pattern, int order) {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setTemplateMode(mode);
        resolver.setResolvablePatterns(Set.of(pattern));
        resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resolver.setOrder(order);
        resolver.setCacheable(true);
        return resolver;
    }
}
