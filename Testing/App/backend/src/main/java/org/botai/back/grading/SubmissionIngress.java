package org.botai.back.grading;

import jakarta.servlet.http.*;
import org.botai.back.security.*;
import org.botai.back.common.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.*;
import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class SubmissionIngress implements WebMvcConfigurer {
    private final RateLimits limits;private final CurrentActor actors;
    @Override public void addInterceptors(InterceptorRegistry registry){registry.addInterceptor(new HandlerInterceptor(){
        @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler){
            if(request.getMethod().equals("GET")||request.getMethod().equals("HEAD")||request.getMethod().equals("OPTIONS"))return true;
            var user=actors.require(SecurityContextHolder.getContext().getAuthentication());
            limits.check("grading-write-user",user.getId().toString(),120,3600);
            // Remote address only: forwarded headers are trusted solely by explicitly configured ingress.
            limits.check("grading-write-ip",request.getRemoteAddr(),600,3600);return true;
        }
    }).addPathPatterns("/api/submissions/**","/api/profile/avatar","/api/attempts/*/checks");}
}
