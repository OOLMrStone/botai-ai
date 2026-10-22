package org.botai.back.common;

public class ApiException extends RuntimeException {
    private final int status;
    private final String code;
    public ApiException(int status, String code, String detail) { super(detail); this.status=status; this.code=code; }
    public int status() { return status; }
    public String code() { return code; }
    public static ApiException notFound() { return new ApiException(404,"not_found","Объект не найден"); }
    public static ApiException conflict(String code) { return new ApiException(409,code,"Данные изменились. Обнови страницу и повтори действие"); }
    public static ApiException invalid(String detail) { return new ApiException(400,"validation_error",detail); }
}
