package org.botai.back.b2b;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.botai.back.common.*;
import org.botai.back.security.*;
import org.botai.back.user.Role;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Runs after session/CSRF security, before any servlet multipart resolver opens the body. */
@Component
@Order(-90)
@RequiredArgsConstructor
public class LocalDemoIngressFilter extends OncePerRequestFilter {
    private final B2bConfig config;private final CurrentActor actors;private final SubmissionOrigins origins;private final RateLimits limits;private final JsonCodec json;
    @Override protected boolean shouldNotFilter(HttpServletRequest request){return !request.getRequestURI().startsWith("/api/local-demo/");}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
        try{config.requireEnabled();var actor=actors.require(SecurityContextHolder.getContext().getAuthentication());config.requireOperator(actor.getId());if(actor.getRole()!=Role.EXPERT||!origins.operatorActive(actor.getId(),false))throw new ApiException(403,"forbidden","Доступ запрещён");if(!SetSafeMethods.safe(request.getMethod())){limits.check("local-demo-write-user",actor.getId().toString(),120,3600);limits.check("local-demo-write-ip",request.getRemoteAddr(),300,3600);}response.setHeader("Cache-Control","private, no-store");chain.doFilter(request,response);}catch(ApiException e){response.setStatus(e.status());response.setContentType("application/problem+json");response.setHeader("Cache-Control","private, no-store");response.getWriter().write(json.write(ApiProblems.of(e.status(),e.code(),e.getMessage())));}
    }
    private static final class SetSafeMethods {static boolean safe(String method){return java.util.Set.of("GET","HEAD","OPTIONS").contains(method);}}
}
