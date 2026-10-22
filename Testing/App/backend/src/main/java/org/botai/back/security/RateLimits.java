package org.botai.back.security;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;

@Service
@RequiredArgsConstructor
public class RateLimits {
    private final JdbcClient jdbc;
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public void check(String scope,String subject,int limit,int windowSeconds) {
        Instant window=Instant.ofEpochSecond(Instant.now().getEpochSecond()/windowSeconds*windowSeconds);
        int count=jdbc.sql("INSERT INTO rate_limit_windows(scope,subject_hash,window_start,count) VALUES(:scope,:subject,:window,1) ON CONFLICT(scope,subject_hash,window_start) DO UPDATE SET count=rate_limit_windows.count+1 RETURNING count")
            .param("scope",scope).param("subject",JsonCodec.sha256(subject)).param("window",java.time.OffsetDateTime.ofInstant(window,java.time.ZoneOffset.UTC)).query(Integer.class).single();
        if(count>limit)throw new ApiException(429,"rate_limited","Слишком много запросов. Попробуй позже");
    }
}
