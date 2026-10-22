package org.botai.back.b2b;

import jakarta.servlet.MultipartConfigElement;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.*;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.DispatcherServlet;

/** Exact servlet mapping gives only this route a 41 MiB aggregate; global 9 MiB stays intact. */
@Configuration
public class LocalDemoMultipartConfig {
    @Bean(name="multipartResolver")
    org.springframework.web.multipart.support.StandardServletMultipartResolver multipartResolver(){
        return new org.springframework.web.multipart.support.StandardServletMultipartResolver(){
            @Override public org.springframework.web.multipart.MultipartHttpServletRequest resolveMultipart(jakarta.servlet.http.HttpServletRequest request){
                try{return super.resolveMultipart(request);}catch(org.springframework.web.multipart.MaxUploadSizeExceededException error){
                    if(request.getRequestURI().equals("/api/local-demo/runs/manual")){
                        // A rejected oversized part can be detected before its bytes arrive. Drain only
                        // this authenticated, route-bounded request so the browser receives the typed 413.
                        try{var input=request.getInputStream();byte[] buffer=new byte[8192];long remaining=41L*1024*1024;while(remaining>0){int read=input.read(buffer,0,(int)Math.min(buffer.length,remaining));if(read<0)break;remaining-=read;}}catch(java.io.IOException ignored){}
                    }
                    throw error;
                }
            }
        };
    }
    @Bean
    ServletRegistrationBean<DispatcherServlet> localDemoManualDispatcher(WebApplicationContext context){
        DispatcherServlet servlet=new DispatcherServlet(context);var registration=new ServletRegistrationBean<>(servlet,"/api/local-demo/runs/manual");registration.setName("localDemoManualDispatcher");registration.setMultipartConfig(new MultipartConfigElement("",8L*1024*1024,41L*1024*1024,0));registration.setLoadOnStartup(1);return registration;
    }
}
