package org.botai.back.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.botai.back.common.ApiException;
import org.botai.back.common.ApiProblems;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;

public class AuthRateLimitFilter extends OncePerRequestFilter {
    private final RateLimits limits;
    private final ObjectMapper json;
    public AuthRateLimitFilter(RateLimits limits,ObjectMapper json) { this.limits=limits;this.json=json; }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        if("POST".equals(request.getMethod())&&request.getRequestURI().startsWith("/api/auth/")) {
            try { limits.check("auth-ip",request.getRemoteAddr(),60,60); }
            catch(ApiException e) { response.setStatus(e.status());response.setContentType("application/problem+json");json.writeValue(response.getOutputStream(),ApiProblems.of(e.status(),e.code(),e.getMessage()));return; }
        }
        chain.doFilter(request,response);
    }
}
