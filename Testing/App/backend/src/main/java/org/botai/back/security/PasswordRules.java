package org.botai.back.security;

import org.botai.back.common.ApiException;
import java.nio.charset.StandardCharsets;
public final class PasswordRules {
    private PasswordRules() { }
    public static void validate(String password) {
        if(password==null||password.getBytes(StandardCharsets.UTF_8).length>72)throw ApiException.invalid("Пароль должен занимать не больше 72 байт UTF-8");
    }
}
