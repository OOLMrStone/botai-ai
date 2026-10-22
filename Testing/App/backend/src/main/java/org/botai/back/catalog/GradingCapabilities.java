package org.botai.back.catalog;

import lombok.RequiredArgsConstructor;
import org.botai.back.grading.port.GradingGateway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class GradingCapabilities {
    private final ObjectProvider<GradingGateway> gateway;
    public String forNumber(int number,int maxPoints) {
        if(number<=13)return "available";
        var adapter=gateway.getIfAvailable();
        if(adapter==null)return "unavailable";
        try {
            var capability=adapter.capabilities().get(number);
            if(capability==null)return "unavailable";
            if(!capability.supported())return "unsupported";
            return capability.maxScore()==maxPoints?"available":"unavailable";
        } catch(RuntimeException failure) { return "unavailable"; }
    }
}
