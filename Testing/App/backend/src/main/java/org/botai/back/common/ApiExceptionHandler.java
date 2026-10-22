package org.botai.back.common;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import java.util.LinkedHashMap;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(ApiException.class) public ProblemDetail api(ApiException e) { return ApiProblems.of(e.status(),e.code(),e.getMessage()); }
    @ExceptionHandler(MethodArgumentNotValidException.class) public ProblemDetail invalid(MethodArgumentNotValidException e) {
        var problem=ApiProblems.of(400,"validation_error","Проверь введённые данные");
        var fields=new LinkedHashMap<String,String>();
        e.getBindingResult().getFieldErrors().stream().limit(10).forEach(error->fields.put(error.getField(),"Некорректное значение"));
        problem.setProperty("fieldErrors",fields);return problem;
    }
    @ExceptionHandler({HttpMessageNotReadableException.class,MethodArgumentTypeMismatchException.class})
    public ProblemDetail malformed(Exception e) { return ApiProblems.of(400,"invalid_request","Некорректный запрос"); }
    @ExceptionHandler(DataIntegrityViolationException.class) public ProblemDetail conflict(DataIntegrityViolationException e) { return ApiProblems.of(409,"data_conflict","Данные изменились. Повтори действие"); }
    @ExceptionHandler(MaxUploadSizeExceededException.class) public ProblemDetail oversized(MaxUploadSizeExceededException e) { return ApiProblems.of(413,"upload_too_large","Файл слишком большой"); }
}
