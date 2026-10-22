package org.botai.back.b2b;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class B2bPrivateResponseFilter extends OncePerRequestFilter {
 @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
   String path=request.getRequestURI();if(path.startsWith("/api/school/")||path.startsWith("/api/local-demo/")||path.startsWith("/api/expert/")||path.startsWith("/api/submissions/")){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}chain.doFilter(request,response);
 }
}
