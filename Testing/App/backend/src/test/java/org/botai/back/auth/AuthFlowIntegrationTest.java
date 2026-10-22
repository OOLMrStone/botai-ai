package org.botai.back.auth;

import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalManagementPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end auth pipeline test against a real Postgres (Testcontainers):
 * CSRF bootstrap, registration, login (session cookie), authenticated request,
 * logout, and the relevant failure paths.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"management.server.port=0", "app.grading.worker-enabled=false"})
@AutoConfigureTestRestTemplate
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AuthFlowIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");

    // Real SMTP sink: the tests read the one-time codes out of actual emails.
    @Container
    static GenericContainer<?> mailpit = new GenericContainer<>("axllent/mailpit:latest")
            .withExposedPorts(1025, 8025);

    @DynamicPropertySource
    static void mailProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.mail.host", mailpit::getHost);
        registry.add("spring.mail.port", () -> mailpit.getMappedPort(1025));
    }

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper objectMapper;

    @LocalManagementPort
    private int managementPort;

    private static final String EMAIL = "alice@example.com";
    private static final String PASSWORD = "correct-horse-battery";
    private static final String NEW_PASSWORD = "staple-battery-horse";

    @Test
    @Order(1)
    void fullRegisterLoginMeLogoutFlow() {
        // 1. CSRF bootstrap. Like the real SPA, we read the raw token from the
        // XSRF-TOKEN cookie and echo it back in the X-XSRF-TOKEN header.
        ResponseEntity<String> csrfResponse = rest.getForEntity("/api/auth/csrf", String.class);
        assertThat(csrfResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        String csrfCookie = extractCookie(csrfResponse.getHeaders(), "XSRF-TOKEN");
        assertThat(csrfCookie).isNotBlank();
        assertThat(objectMapper.readTree(csrfResponse.getBody()).get("token").asString()).isNotBlank();

        // 2. Register
        ResponseEntity<String> registerResponse = postJson("/api/auth/register",
                """
                {"email": "%s", "password": "%s", "displayName": "Alice"}
                """.formatted(EMAIL, PASSWORD),
                csrfCookie, csrfCookie, null);
        assertThat(registerResponse.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        JsonNode registered = objectMapper.readTree(registerResponse.getBody());
        assertThat(registered.get("email").asString()).isEqualTo(EMAIL);
        assertThat(registered.get("authProvider").asString()).isEqualTo("LOCAL");
        // password (or its hash) must never leak into the response
        assertThat(registerResponse.getBody()).doesNotContain(PASSWORD).doesNotContain("password");

        // 3. Login: establishes the server-side session, sets the SESSION cookie
        ResponseEntity<String> loginResponse = postJson("/api/auth/login",
                """
                {"email": "%s", "password": "%s"}
                """.formatted(EMAIL, PASSWORD),
                csrfCookie, csrfCookie, null);
        assertThat(loginResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        String sessionCookie = extractCookie(loginResponse.getHeaders(), "SESSION");
        assertThat(sessionCookie).isNotBlank();

        // 4. Authenticated request with the session cookie
        ResponseEntity<String> meResponse = getWithCookies("/api/auth/me",
                "SESSION=" + sessionCookie);
        assertThat(meResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(objectMapper.readTree(meResponse.getBody()).get("email").asString()).isEqualTo(EMAIL);

        // 5. A forged/garbage session cookie is rejected
        ResponseEntity<String> forgedResponse = getWithCookies("/api/auth/me",
                "SESSION=" + "Zm9yZ2VkLXNlc3Npb24taWQtMTIzNDU2Nzg5MGFiY2RlZg==");
        assertThat(forgedResponse.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        // 6. Logout invalidates the session server-side
        ResponseEntity<String> logoutResponse = postJson("/api/auth/logout", null,
                csrfCookie, csrfCookie, sessionCookie);
        assertThat(logoutResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        ResponseEntity<String> afterLogout = getWithCookies("/api/auth/me",
                "SESSION=" + sessionCookie);
        assertThat(afterLogout.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @Order(2)
    void rejectsDuplicateEmailWrongPasswordAndMissingCsrf() {
        ResponseEntity<String> csrfResponse = rest.getForEntity("/api/auth/csrf", String.class);
        String csrfCookie = extractCookie(csrfResponse.getHeaders(), "XSRF-TOKEN");

        // duplicate email (registered in the previous test) -> 409
        ResponseEntity<String> duplicate = postJson("/api/auth/register",
                """
                {"email": "%s", "password": "%s"}
                """.formatted(EMAIL.toUpperCase(), PASSWORD),
                csrfCookie, csrfCookie, null);
        assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        // wrong password -> 401 with a generic message (no account enumeration)
        ResponseEntity<String> badLogin = postJson("/api/auth/login",
                """
                {"email": "%s", "password": "wrong-password"}
                """.formatted(EMAIL),
                csrfCookie, csrfCookie, null);
        assertThat(badLogin.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(badLogin.getBody()).contains("Invalid email or password");

        // unknown email must produce the exact same response
        ResponseEntity<String> unknownLogin = postJson("/api/auth/login",
                """
                {"email": "nobody@example.com", "password": "wrong-password"}
                """,
                csrfCookie, csrfCookie, null);
        assertThat(unknownLogin.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(unknownLogin.getBody()).contains("Invalid email or password");

        // missing CSRF token -> rejected before the endpoint runs, even with
        // valid credentials (403 is the frozen API CSRF contract)
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> noCsrf = rest.exchange("/api/auth/login", HttpMethod.POST,
                new HttpEntity<>("""
                        {"email": "%s", "password": "%s"}
                        """.formatted(EMAIL, PASSWORD), headers),
                String.class);
        assertThat(noCsrf.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(extractCookie(noCsrf.getHeaders(), "SESSION")).isNull();

        // weak password -> 400 (bean validation)
        ResponseEntity<String> weakPassword = postJson("/api/auth/register",
                """
                {"email": "bob@example.com", "password": "short"}
                """,
                csrfCookie, csrfCookie, null);
        assertThat(weakPassword.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @Order(3)
    void exposesPrometheusMetricsOnManagementPortOnly() {
        // Management port: scrape works without a session, includes the standard
        // HTTP metrics and our auth counters (incremented by the tests above).
        ResponseEntity<String> scrape = rest.getForEntity(
                "http://localhost:" + managementPort + "/actuator/prometheus", String.class);
        assertThat(scrape.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(scrape.getBody())
                .contains("http_server_requests_seconds_count")
                .contains("auth_registrations_total{")
                .contains("auth_logins_total{application=\"back\",method=\"password\",result=\"success\"}")
                .contains("auth_logins_total{application=\"back\",method=\"password\",result=\"failure\"}");

        // The public API port serves no actuator endpoints at all.
        ResponseEntity<String> viaApiPort = rest.getForEntity("/actuator/prometheus", String.class);
        assertThat(viaApiPort.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @Order(4)
    void otpLoginFlow() {
        ResponseEntity<String> csrfResponse = rest.getForEntity("/api/auth/csrf", String.class);
        String csrf = extractCookie(csrfResponse.getHeaders(), "XSRF-TOKEN");

        // unknown account: identical 202, but nothing is emailed
        ResponseEntity<String> ghost = postJson("/api/auth/otp/request",
                """
                {"email": "ghost@example.com"}
                """, csrf, csrf, null);
        assertThat(ghost.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        // real account: 202 + email with a 6-digit code
        ResponseEntity<String> request = postJson("/api/auth/otp/request",
                """
                {"email": "%s"}
                """.formatted(EMAIL), csrf, csrf, null);
        assertThat(request.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        String code = latestEmailedCode(EMAIL, "Код для входа");

        // wrong code -> 401 with the generic message
        String wrongCode = code.equals("000000") ? "111111" : "000000";
        ResponseEntity<String> wrong = postJson("/api/auth/otp/login",
                """
                {"email": "%s", "code": "%s"}
                """.formatted(EMAIL, wrongCode), csrf, csrf, null);
        assertThat(wrong.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(wrong.getBody()).contains("Invalid or expired code");

        // correct code -> logged in, session cookie set
        ResponseEntity<String> login = postJson("/api/auth/otp/login",
                """
                {"email": "%s", "code": "%s"}
                """.formatted(EMAIL, code), csrf, csrf, null);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(objectMapper.readTree(login.getBody()).get("email").asString()).isEqualTo(EMAIL);
        String sessionCookie = extractCookie(login.getHeaders(), "SESSION");
        assertThat(sessionCookie).isNotBlank();
        assertThat(getWithCookies("/api/auth/me", "SESSION=" + sessionCookie).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // the code is single-use
        ResponseEntity<String> replay = postJson("/api/auth/otp/login",
                """
                {"email": "%s", "code": "%s"}
                """.formatted(EMAIL, code), csrf, csrf, null);
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @Order(5)
    void passwordResetFlowInvalidatesSessionsAndOldPassword() {
        ResponseEntity<String> csrfResponse = rest.getForEntity("/api/auth/csrf", String.class);
        String csrf = extractCookie(csrfResponse.getHeaders(), "XSRF-TOKEN");

        // a live session that must die after the reset
        ResponseEntity<String> login = postJson("/api/auth/login",
                """
                {"email": "%s", "password": "%s"}
                """.formatted(EMAIL, PASSWORD), csrf, csrf, null);
        String sessionCookie = extractCookie(login.getHeaders(), "SESSION");
        assertThat(sessionCookie).isNotBlank();

        // request the reset code and read it from the email
        ResponseEntity<String> request = postJson("/api/auth/password/reset-request",
                """
                {"email": "%s"}
                """.formatted(EMAIL), csrf, csrf, null);
        assertThat(request.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        String code = latestEmailedCode(EMAIL, "Сброс пароля");

        ResponseEntity<String> reset = postJson("/api/auth/password/reset",
                """
                {"email": "%s", "code": "%s", "newPassword": "%s"}
                """.formatted(EMAIL, code, NEW_PASSWORD), csrf, csrf, null);
        assertThat(reset.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // the pre-reset session has been invalidated server-side
        assertThat(getWithCookies("/api/auth/me", "SESSION=" + sessionCookie).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        // old password dead, new password works
        ResponseEntity<String> oldPassword = postJson("/api/auth/login",
                """
                {"email": "%s", "password": "%s"}
                """.formatted(EMAIL, PASSWORD), csrf, csrf, null);
        assertThat(oldPassword.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        ResponseEntity<String> newPassword = postJson("/api/auth/login",
                """
                {"email": "%s", "password": "%s"}
                """.formatted(EMAIL, NEW_PASSWORD), csrf, csrf, null);
        assertThat(newPassword.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @Order(6)
    void emailVerificationLinkFlow() {
        ResponseEntity<String> csrfResponse = rest.getForEntity("/api/auth/csrf", String.class);
        String csrf = extractCookie(csrfResponse.getHeaders(), "XSRF-TOKEN");
        String email = "verify-me@example.com";

        // Registration sends the verification link by itself.
        ResponseEntity<String> register = postJson("/api/auth/register",
                """
                {"email": "%s", "password": "%s"}
                """.formatted(email, PASSWORD), csrf, csrf, null);
        assertThat(register.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(objectMapper.readTree(register.getBody()).get("emailVerified").asBoolean())
                .as("fresh account starts unverified").isFalse();

        String token = latestEmailedToken(email);

        // A tampered token is rejected, and the real one still works afterwards -
        // failures must not consume the token.
        ResponseEntity<String> tampered = postJson("/api/auth/email/verify",
                """
                {"token": "%s"}
                """.formatted(token.substring(0, token.length() - 2) + "xy"), csrf, csrf, null);
        assertThat(tampered.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        ResponseEntity<String> verify = postJson("/api/auth/email/verify",
                """
                {"token": "%s"}
                """.formatted(token), csrf, csrf, null);
        assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // The flag is now visible on the session's own user.
        ResponseEntity<String> login = postJson("/api/auth/login",
                """
                {"email": "%s", "password": "%s"}
                """.formatted(email, PASSWORD), csrf, csrf, null);
        assertThat(objectMapper.readTree(login.getBody()).get("emailVerified").asBoolean()).isTrue();

        // The link is single-use.
        ResponseEntity<String> replay = postJson("/api/auth/email/verify",
                """
                {"token": "%s"}
                """.formatted(token), csrf, csrf, null);
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    /** Pulls the verification link out of the email and returns its token parameter. */
    @Test
    @Order(7)
    void unicodePasswordAndProfilePrivilegeBoundary() {
        String csrf=extractCookie(rest.getForEntity("/api/auth/csrf",String.class).getHeaders(),"XSRF-TOKEN");
        var tooLong=postJson("/api/auth/register", "{\"email\":\"utf8@example.test\",\"password\":\""+"я".repeat(37)+"\"}",csrf,csrf,null);
        assertThat(tooLong.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(tooLong.getBody()).contains("validation_error","requestId");
        String email="profile-boundary@example.test";
        assertThat(postJson("/api/auth/register","{\"email\":\""+email+"\",\"password\":\""+PASSWORD+"\"}",csrf,csrf,null).getStatusCode()).isEqualTo(HttpStatus.CREATED);
        var login=postJson("/api/auth/login","{\"email\":\""+email+"\",\"password\":\""+PASSWORD+"\"}",csrf,csrf,null);
        String session=extractCookie(login.getHeaders(),"SESSION");
        assertThat(login.getHeaders().get(HttpHeaders.SET_COOKIE)).anyMatch(cookie->cookie.startsWith("XSRF-TOKEN="));
        var fresh=getWithCookies("/api/auth/csrf","SESSION="+session);String token=extractCookie(fresh.getHeaders(),"XSRF-TOKEN");
        assertThat(token).isNotBlank().isNotEqualTo(csrf);
        HttpHeaders headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.set("Cookie","SESSION="+session+"; XSRF-TOKEN="+token);headers.set("X-XSRF-TOKEN",token);
        var elevation=rest.exchange("/api/profile",HttpMethod.PATCH,new HttpEntity<>("{\"plan\":\"pro\"}",headers),String.class);
        assertThat(elevation.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(getWithCookies("/api/profile","SESSION="+session).getBody()).contains("\"plan\":\"free\"").doesNotContain("passwordHash");
        assertThat(getWithCookies("/api/admin/submissions","SESSION="+session).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(getWithCookies("/api/auth/session/verified","SESSION="+session).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    private String latestEmailedToken(String toAddress) {
        String base = "http://" + mailpit.getHost() + ":" + mailpit.getMappedPort(8025);
        for (int i = 0; i < 50; i++) {
            JsonNode messages = objectMapper
                    .readTree(rest.getForObject(base + "/api/v1/messages", String.class))
                    .get("messages");
            for (JsonNode message : messages) {
                if (message.get("To").get(0).get("Address").asString().equals(toAddress)
                        && message.get("Subject").asString().contains("Подтверждение почты")) {
                    JsonNode detail = objectMapper.readTree(rest.getForObject(
                            base + "/api/v1/message/" + message.get("ID").asString(), String.class));

                    Matcher matcher = Pattern
                            .compile("/verify-email\\?token=([A-Za-z0-9._%-]+)")
                            .matcher(detail.get("Text").asString());
                    assertThat(matcher.find()).as("verification link in plain-text part").isTrue();
                    String token = URLDecoder.decode(matcher.group(1), StandardCharsets.UTF_8);

                    // The clickable button must carry the same link.
                    assertThat(detail.get("HTML").asString())
                            .as("HTML part").contains("Подтвердить почту").contains(matcher.group(1));
                    return token;
                }
            }
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }
        throw new AssertionError("No verification email to " + toAddress);
    }

    /**
     * Polls the Mailpit REST API for the newest message to {@code toAddress}
     * whose subject contains {@code subjectContains}, and extracts the 6-digit
     * code from its body. Sending is async, hence the polling.
     */
    private String latestEmailedCode(String toAddress, String subjectContains) {
        String base = "http://" + mailpit.getHost() + ":" + mailpit.getMappedPort(8025);
        for (int i = 0; i < 50; i++) {
            JsonNode messages = objectMapper
                    .readTree(rest.getForObject(base + "/api/v1/messages", String.class))
                    .get("messages");
            for (JsonNode message : messages) {
                if (message.get("To").get(0).get("Address").asString().equals(toAddress)
                        && message.get("Subject").asString().contains(subjectContains)) {
                    JsonNode detail = objectMapper.readTree(rest.getForObject(
                            base + "/api/v1/message/" + message.get("ID").asString(), String.class));

                    String text = detail.get("Text").asString();
                    Matcher matcher = Pattern.compile("\\d{6}").matcher(text);
                    assertThat(matcher.find()).as("code in plain-text part").isTrue();
                    String code = matcher.group();

                    // multipart/alternative: the HTML part carries the same code...
                    assertThat(detail.get("HTML").asString())
                            .as("HTML part").contains(code).contains("botai");
                    // ...and the subject carries none, so it cannot leak from a
                    // lock-screen notification preview.
                    assertThat(message.get("Subject").asString()).doesNotContain(code);
                    return code;
                }
            }
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }
        throw new AssertionError(
                "No email to %s with subject containing '%s'".formatted(toAddress, subjectContains));
    }

    private ResponseEntity<String> postJson(String path, String body, String csrfCookie,
                                            String csrfToken, String sessionCookie) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-XSRF-TOKEN", csrfToken);
        String cookies = "XSRF-TOKEN=" + csrfCookie;
        if (sessionCookie != null) {
            cookies += "; SESSION=" + sessionCookie;
        }
        headers.set(HttpHeaders.COOKIE, cookies);
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
    }

    private ResponseEntity<String> getWithCookies(String path, String cookies) {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.COOKIE, cookies);
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), String.class);
    }

    private static String extractCookie(HttpHeaders headers, String name) {
        List<String> setCookies = headers.getOrEmpty(HttpHeaders.SET_COOKIE);
        return setCookies.stream()
                .filter(c -> c.startsWith(name + "="))
                .map(c -> c.substring(name.length() + 1, c.indexOf(';')))
                .findFirst()
                .orElse(null);
    }
}
