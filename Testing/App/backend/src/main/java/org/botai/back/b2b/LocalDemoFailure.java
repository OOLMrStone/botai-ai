package org.botai.back.b2b;

import java.util.*;
import tools.jackson.databind.JsonNode;

/** Bounded diagnostic facts only: never model text, arbitrary paths or provider bodies. */
final class LocalDemoFailure {
    private LocalDemoFailure() { }
    static final Set<String> CATEGORIES = Set.of("model_response", "network", "provider", "configuration", "input", "timeout", "internal");
    static final Set<String> PHASES = Set.of("input", "task_preparation", "task_input", "ocr", "layout", "analysis", "grading", "validation", "preparation", "diagrams");
    private static final Map<String,Integer> RANGES = Map.of("input",3,"network",4,"provider",5,"model_response",6,"configuration",7,"timeout",8,"internal",9);

    static Map<String,Object> safe(JsonNode raw) {
        Map<String,Object> out = new LinkedHashMap<>();
        if (raw == null || !raw.isObject()) return out;
        var category = raw.get("failure_category");
        if (category != null && category.isString() && CATEGORIES.contains(category.asText())) {
            out.put("failureCategory", category.asText());
            var code = raw.get("diagnostic_code");
            if (integer(code,300,999) && code.asInt()/100 == RANGES.get(category.asText())) out.put("diagnosticCode",code.asInt());
        }
        text(raw,out,"reason_code","reasonCode","[a-z][a-z0-9_]{0,95}");
        text(raw,out,"step","step","[a-z][a-z0-9_.-]{0,95}");
        var phase=raw.get("phase");
        if(phase!=null&&phase.isString()&&PHASES.contains(phase.asText()))out.put("phase",phase.asText());
        for(String key:List.of("attempt","max_attempts")) {
            var value=raw.get(key);
            if(integer(value,1,4) && (!key.equals("max_attempts") || value.asInt()==4))out.put(key.equals("attempt")?key:"maxAttempts",value.asInt());
        }
        for(String key:List.of("retryable","exhausted")) {
            var value=raw.get(key); if(value!=null&&value.isBoolean())out.put(key,value.asBoolean());
        }
        var counts=raw.get("failure_counts");
        if(counts!=null&&counts.isObject()) {
            Map<String,Integer> safeCounts=new LinkedHashMap<>();
            for(String categoryName:CATEGORIES)if(integer(counts.get(categoryName),0,4))safeCounts.put(categoryName,counts.get(categoryName).asInt());
            if(!safeCounts.isEmpty())out.put("failureCounts",safeCounts);
        }
        list(raw,out,"issue_codes","issueCodes","[a-z][a-z0-9_]{0,95}");
        list(raw,out,"issue_paths","issuePaths","\\$(?:\\.[a-zA-Z_][a-zA-Z0-9_]{0,63}|\\[[0-9]{1,4}\\]){0,12}");
        return out;
    }
    static Map<String,Object> failure(JsonNode data) {
        // Revalidate persisted camelCase facts rather than trusting arbitrary historical metadata.
        var raw=tools.jackson.databind.json.JsonMapper.builder().build().createObjectNode();
        Map<String,String> names=Map.ofEntries(Map.entry("failureCategory","failure_category"),Map.entry("diagnosticCode","diagnostic_code"),Map.entry("reasonCode","reason_code"),Map.entry("phase","phase"),Map.entry("step","step"),Map.entry("attempt","attempt"),Map.entry("maxAttempts","max_attempts"),Map.entry("failureCounts","failure_counts"),Map.entry("retryable","retryable"),Map.entry("exhausted","exhausted"),Map.entry("issueCodes","issue_codes"),Map.entry("issuePaths","issue_paths"));
        if(data!=null&&data.isObject())for(var entry:names.entrySet())if(data.has(entry.getKey()))raw.set(entry.getValue(),data.get(entry.getKey()));
        Map<String,Object> result=safe(raw);
        if(!result.containsKey("failureCategory"))return null;
        result.put("category",result.remove("failureCategory"));
        return result;
    }
    private static boolean integer(JsonNode n,int min,int max){return n!=null&&n.isIntegralNumber()&&n.canConvertToInt()&&n.asInt()>=min&&n.asInt()<=max;}
    private static void text(JsonNode raw,Map<String,Object> out,String key,String target,String pattern){var n=raw.get(key);if(n!=null&&n.isString()&&n.asText().matches(pattern))out.put(target,n.asText());}
    private static void list(JsonNode raw,Map<String,Object> out,String key,String target,String pattern){var n=raw.get(key);if(n==null||!n.isArray()||n.size()>30)return;List<String> values=new ArrayList<>();for(var v:n)if(v.isString()&&v.asText().length()<=512&&v.asText().matches(pattern))values.add(v.asText());if(!values.isEmpty())out.put(target,values);}
}
