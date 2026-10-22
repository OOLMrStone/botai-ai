package org.botai.back.b2b;

import java.util.*;
import org.botai.back.common.*;
import org.botai.back.security.*;
import org.botai.back.user.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class LocalDemoIngressFilterTest {
 JsonCodec json=B2bAiResponseValidatorTest.JSON;
 @Test void disabledAndMissingCsrfAreRejectedBeforeAnyMultipartOrActorRead()throws Exception{var request=new MockHttpServletRequest("POST","/api/local-demo/runs/manual");request.setContentType("multipart/form-data; boundary=x");var response=new MockHttpServletResponse();new LocalDemoFeatureFilter(new B2bConfig(false,false,""),json).doFilter(request,response,(r,s)->{throw new AssertionError("body must not be parsed");});assertThat(response.getStatus()).isEqualTo(404);var enabled=new MockHttpServletResponse();new LocalDemoFeatureFilter(new B2bConfig(true,false,""),json).doFilter(request,enabled,(r,s)->{throw new AssertionError("CSRF header required before parsing");});assertThat(enabled.getStatus()).isEqualTo(403);}
 @Test void wrongRoleAndInactiveOperatorAreDeniedBeforeDispatcher()throws Exception{for(boolean expert:List.of(false,true)){User user=User.builder().email("test@example.test").role(expert?Role.EXPERT:Role.USER).build();var actors=mock(CurrentActor.class);when(actors.require(any())).thenReturn(user);var origins=mock(SubmissionOrigins.class);var limits=mock(RateLimits.class);var filter=new LocalDemoIngressFilter(new B2bConfig(true,false,user.getId().toString()),actors,origins,limits,json);var request=new MockHttpServletRequest("POST","/api/local-demo/runs/manual");var response=new MockHttpServletResponse();filter.doFilter(request,response,(r,s)->{throw new AssertionError("Denied before multipart");});assertThat(response.getStatus()).isEqualTo(403);verifyNoInteractions(limits);}}
}
