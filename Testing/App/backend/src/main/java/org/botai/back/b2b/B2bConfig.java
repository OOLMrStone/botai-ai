package org.botai.back.b2b;

import java.util.*;
import org.botai.back.common.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class B2bConfig {
    private final boolean enabled,allowLive;
    private final Set<UUID> operators;
    public B2bConfig(@Value("${app.b2b.local-enabled:false}") boolean enabled,@Value("${app.b2b.allow-live:false}") boolean allowLive,@Value("${app.b2b.operator-user-ids:}") String ids) {
        this.enabled=enabled;this.allowLive=allowLive;
        var parsed=new HashSet<UUID>();for(String value:ids.split(","))if(!value.isBlank())parsed.add(UUID.fromString(value.trim()));operators=Set.copyOf(parsed);
    }
    public boolean enabled(){return enabled;}
    public void requireEnabled(){if(!enabled)throw ApiException.notFound();}
    public boolean operator(UUID id){return enabled&&operators.contains(id);}
    public void requireOperator(UUID id){requireEnabled();if(!operator(id))throw new ApiException(403,"forbidden","Доступ запрещён");}
    public void requireProvider(String mode){requireEnabled();if(!"mock".equals(mode)&&!("live".equals(mode)&&allowLive))throw new ApiException(403,"b2b_live_disabled","Реальная проверка локального стенда отключена");}
}
