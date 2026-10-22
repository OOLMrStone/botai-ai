package org.botai.back.b2b;

import java.util.Map;
import org.botai.back.common.ApiException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** An error with bounded public diagnostics; never retains a provider/model body. */
public final class B2bAiException extends ApiException {
    private final Map<String,Object> failure;
    private B2bAiException(String code,Map<String,Object> failure){super(502,code,"Оценка временно недоступна");this.failure=Map.copyOf(failure);}
    public Map<String,Object> failure(){return failure;}
    public static ApiException from(String code,JsonNode details){
        var mapper=JsonMapper.builder().build();
        var safe=LocalDemoFailure.failure(mapper.valueToTree(LocalDemoFailure.safe(details)));
        return safe==null?new ApiException(502,code,"Оценка временно недоступна"):new B2bAiException(code,safe);
    }
}
