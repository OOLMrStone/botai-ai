package org.botai.back.security;

import org.springframework.boot.security.autoconfigure.actuate.web.servlet.EndpointRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, CookieCsrfTokenRepository csrfRepository,
            RateLimits rateLimits, tools.jackson.databind.ObjectMapper mapper, org.botai.back.user.UserRepository users) throws Exception {
        http
                // CSRF: double-submit pattern for the SPA. The token travels in the
                // XSRF-TOKEN cookie (readable by the frontend), which sends it back
                // in the X-XSRF-TOKEN header on every mutating request.
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfRepository)
                        .ignoringRequestMatchers(request -> request.getMethod().equals("POST") && request.getRequestURI().equals("/api/billing/yookassa/test/webhook"))
                        .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler()))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(org.springframework.http.HttpMethod.POST,"/api/billing/yookassa/test/webhook").permitAll()
                        .requestMatchers(
                                "/api/auth/register", "/api/auth/login", "/api/auth/csrf",
                                "/api/auth/otp/request", "/api/auth/otp/login",
                                "/api/auth/password/reset-request", "/api/auth/password/reset",
                                "/api/auth/email/verify-request", "/api/auth/email/verify").permitAll()
                        // Actuator (health/prometheus) is served on the separate
                        // management port, which must stay internal-only; no
                        // additional auth on top of that network boundary.
                        .requestMatchers(EndpointRequest.toAnyEndpoint()).permitAll()
                        .requestMatchers("/api/admin/**").access((authentication, context) -> new org.springframework.security.authorization.AuthorizationDecision(
                            users.findByEmail(authentication.get().getName()).filter(org.botai.back.user.User::isEnabled).filter(user -> user.getRole() == org.botai.back.user.Role.ADMIN).isPresent()))
                        .anyRequest().authenticated())
                // Session fixation protection: the session id rotates on login
                // (see AuthService), so a pre-login cookie can never be promoted
                // to an authenticated one.
                .logout(logout -> logout
                        .logoutUrl("/api/auth/logout")
                        .invalidateHttpSession(true)
                        .deleteCookies("SESSION")
                        .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler()))
                // This is a JSON API: unauthenticated requests get a 401, never a
                // redirect to a login page.
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, exception) -> {
                            response.setStatus(401); response.setContentType("application/problem+json");
                            mapper.writeValue(response.getOutputStream(), org.botai.back.common.ApiProblems.of(401,"session_required","Войди в аккаунт"));
                        })
                        .accessDeniedHandler((request, response, exception) -> {
                            response.setStatus(403); response.setContentType("application/problem+json");
                            mapper.writeValue(response.getOutputStream(), org.botai.back.common.ApiProblems.of(403,"forbidden","Доступ запрещён"));
                        }))
                .addFilterBefore(new AuthRateLimitFilter(rateLimits, mapper), org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new org.botai.back.billing.BillingBodyFilter(mapper),org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new org.botai.back.expert.ExpertBodyFilter(mapper),org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter.class);

        // ---------------------------------------------------------------------
        // External login (Google etc.) — enable together with the
        // spring.security.oauth2.client.registration section in application.yaml:
        //
        // http.oauth2Login(oauth -> oauth
        //         .userInfoEndpoint(userInfo -> userInfo.oidcUserService(customOidcUserService))
        //         .defaultSuccessUrl("/", true));
        //
        // The users table already supports it: auth_provider + provider_id columns,
        // nullable password_hash. The custom OIDC user service should find-or-create
        // a User row by (provider, providerId).
        // ---------------------------------------------------------------------

        return http.build();
    }

    @Bean
    CookieCsrfTokenRepository csrfTokenRepository() {
        return CookieCsrfTokenRepository.withHttpOnlyFalse();
    }

    @Bean
    org.springframework.security.web.authentication.session.SessionAuthenticationStrategy sessionAuthenticationStrategy(CookieCsrfTokenRepository csrfRepository) {
        return new org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy(java.util.List.of(
            new org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy(),
            new org.springframework.security.web.csrf.CsrfAuthenticationStrategy(csrfRepository)));
    }

    /**
     * BCrypt by default (via the delegating encoder, so the algorithm can be
     * upgraded later without breaking existing hashes). BCrypt generates and
     * embeds a random per-password salt in the hash itself.
     */
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    AuthenticationManager authenticationManager(UserDetailsService userDetailsService,
                                                PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(provider);
    }

    /**
     * Persists the authenticated SecurityContext into the HTTP session, which
     * Spring Session stores in Postgres.
     */
    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }
}
