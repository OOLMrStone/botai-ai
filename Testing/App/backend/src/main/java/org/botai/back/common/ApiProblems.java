package org.botai.back.common;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
public final class ApiProblems {
    private ApiProblems() { }
    public static ProblemDetail of(int status,String code,String detail) {
        var problem=ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(status),detail);
        problem.setType(java.net.URI.create("urn:botai:problem:"+code));
        problem.setProperty("code",code);problem.setProperty("requestId",RequestIds.current());return problem;
    }
}
