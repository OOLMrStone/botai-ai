package org.botai.back.catalog.importing;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.JsonCodec;
import org.botai.back.media.ImageNormalizer;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

@Component
@RequiredArgsConstructor
public class ImportPackageValidator {
    private static final JsonMapper JSON=JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    public static final String GRANT="user-grant-2026-10-05-shkolkovo-named-groups";
    public static final String BANKZADACH_GRANT="user-grant-2026-10-06-bankzadach";
    private record ProviderPolicy(String identity,String host,String path,String grant,Set<String> groups) { }
    private static final Map<String,ProviderPolicy> PROVIDERS=Map.of(
        "shkolkovo",new ProviderPolicy("[0-9]{1,32}","3.shkolkovo.online","/catalog/[0-9]+/",GRANT,Set.of("past-ege","fipi","statgrad","egkr","yashchenko")),
        "bankzadach",new ProviderPolicy("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}","bank-zadach.ru","/task/",BANKZADACH_GRANT,Set.of("bankzadach")));
    private final ImageNormalizer normalizer;
    private final ImportMathValidator math;
    public record Asset(String id,String purpose,String rawHash,String hash,ImageNormalizer.Normalized image) { }
    public record Prepared(JsonNode source,List<Asset> assets,String contentHash,String versionHash,boolean aiReady) { }
    public JsonNode parse(String line) {
        if(line.length()>262144||line.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>262144)throw fail("line_limit");
        try { return JSON.readTree(line); } catch(Exception failure) { throw fail("invalid_json"); }
    }
    public Prepared validate(JsonNode root,Path packageRoot) {
        object(root,Set.of("schemaVersion","provider","externalId","formatId","examNumber","topicIds","difficulty","sourceYear","content","statement","referenceAnswer","referenceSolution","acceptedAnswers","provenance","assets"),Set.of("referenceContent","referenceAnswerContent"));
        require("botai-content.v1".equals(text(root.get("schemaVersion"),64)),"schema_version");
        String provider=text(root.get("provider"),64);ProviderPolicy policy=PROVIDERS.get(provider);
        require(policy!=null,"provider_scope");
        require(text(root.get("externalId"),128).matches(policy.identity()),"invalid_identity");
        require("ege-profile-20-v1".equals(text(root.get("formatId"),64)),"format_scope");
        int number=integer(root.get("examNumber"),1,20);
        uniqueStrings(root.get("topicIds"),1,32,80);
        if(root.get("difficulty").isTextual())require(Set.of("easy","medium","hard").contains(text(root.get("difficulty"),16)),"difficulty");
        else if(!root.get("difficulty").isNull())integer(root.get("difficulty"),1,5);
        if(!root.get("sourceYear").isNull())integer(root.get("sourceYear"),1900,2100);
        text(root.get("statement"),16000);if(!root.get("referenceAnswer").isNull())text(root.get("referenceAnswer"),16000);
        if(!root.get("referenceSolution").isNull())text(root.get("referenceSolution"),32000);
        uniqueStrings(root.get("acceptedAnswers"),number<=13?1:0,64,2000);
        if(number<=13&&!root.get("referenceAnswer").isNull())require(uniqueStrings(root.get("acceptedAnswers"),1,64,2000).stream().map(value->value.strip().replace(',','.')).anyMatch(root.get("referenceAnswer").asText().strip().replace(',','.')::equals),"answer_mismatch");
        provenance(root.get("provenance"),root.get("externalId").asText(),policy);
        var nodes=root.get("assets");require(nodes.isArray()&&nodes.size()<=272,"asset_count");
        Map<String,Asset> assets=new LinkedHashMap<>();long size=0,pixels=0;
        for(var node:nodes) {
            object(node,Set.of("id","path","sha256","purpose"),Set.of());
            String id=text(node.get("id"),128);require(id.matches("[a-zA-Z0-9._-]+")&&!assets.containsKey(id),"asset_identity");
            String purpose=text(node.get("purpose"),16);require(Set.of("statement","reference").contains(purpose),"asset_purpose");
            String expected=text(node.get("sha256"),64);require(expected.matches("[a-f0-9]{64}"),"asset_hash");
            byte[] bytes=assetBytes(packageRoot,text(node.get("path"),512));require(expected.equals(hash(bytes)),"asset_hash");
            ImageNormalizer.Normalized image;
            try { image=normalizer.normalizeCatalog(new ByteArrayInputStream(bytes)); }
            catch(Exception failure) { throw fail("unsafe_media"); }
            size+=image.bytes().length;pixels+=(long)image.width()*image.height();require(size<=67108864&&pixels<=64000000,"asset_aggregate");
            assets.put(id,new Asset(id,purpose,expected,hash(image.bytes()),image));
        }
        Set<String> used=new HashSet<>();int[] counts=new int[2];var formulas=new ArrayList<ImportMathValidator.Formula>();
        blocks(root.get("content"),"statement",assets,used,counts,true,formulas);
        JsonNode references=root.has("referenceContent")?root.get("referenceContent"):JSON.createArrayNode();
        blocks(references,"reference",assets,used,counts,false,formulas);
        JsonNode answerContent=root.has("referenceAnswerContent")?root.get("referenceAnswerContent"):JSON.createArrayNode();
        blocks(answerContent,"reference",assets,used,counts,false,formulas);
        require(!root.get("referenceAnswer").isNull()||(number>=14&&!answerContent.isEmpty()),"missing_answer");
        require(used.equals(assets.keySet()),"unused_asset");
        require(root.get("referenceSolution").isTextual()||!references.isEmpty(),"missing_solution");
        require(counts[0]<=256&&counts[1]<=16,"asset_count");
        math.validateAll(formulas);
        Map<String,Object> content=new TreeMap<>();
        for(String field:List.of("formatId","examNumber","topicIds","difficulty","sourceYear","content","statement","referenceAnswer","referenceSolution","acceptedAnswers"))content.put(field,plain(root.get(field),assets));
        for(String field:List.of("topicIds","acceptedAnswers")) { var values=new ArrayList<String>();root.get(field).forEach(value->values.add(value.asText()));Collections.sort(values);content.put(field,values); }
        content.put("referenceContent",plain(references,assets));
        content.put("referenceAnswerContent",plain(answerContent,assets));
        String contentHash=JsonCodec.sha256(JSON.writeValueAsString(content));
        Map<String,Object> provenance=new TreeMap<>();for(var field:root.get("provenance").properties())if(!Set.of("retrievedAt","extractorVersion").contains(field.getKey()))provenance.put(field.getKey(),plain(field.getValue(),Map.of()));
        var groups=new ArrayList<String>();root.get("provenance").get("sourceGroups").forEach(value->groups.add(value.asText()));Collections.sort(groups);provenance.put("sourceGroups",groups);
        String versionHash=JsonCodec.sha256(JSON.writeValueAsString(new TreeMap<>(Map.of("content",content,"provenance",provenance))));
        // Image/formula fallback is complete for the UI, but cannot become an incomplete text-only AI input.
        boolean ready=!root.get("referenceAnswer").isNull()&&assets.isEmpty()&&!root.get("statement").asText().contains("\uFFFC")&&!root.get("referenceAnswer").asText().contains("\uFFFC")
            &&(root.get("referenceSolution").isNull()||!root.get("referenceSolution").asText().contains("\uFFFC"))
            &&projection(root.get("content")).equals(compact(root.get("statement").asText()))
            &&(answerContent.isEmpty()||projection(answerContent).equals(compact(root.get("referenceAnswer").asText())))
            &&(references.isEmpty()||(!root.get("referenceSolution").isNull()&&projection(references).equals(compact(root.get("referenceSolution").asText()))));
        return new Prepared(root,List.copyOf(assets.values()),contentHash,versionHash,ready);
    }
    private void provenance(JsonNode node,String external,ProviderPolicy policy) {
        object(node,Set.of("sourceUrl","sourceGroups","originalPublisher","originalReferences","permissionRef","mappingRevision","retrievedAt","extractorVersion"),Set.of());
        URI url=safeUrl(text(node.get("sourceUrl"),2048),Set.of(policy.host()));
        String suffix=policy.host().equals("bank-zadach.ru")?"/":"";
        require(url.getRawQuery()==null&&url.getRawPath().matches(policy.path()+external+suffix),"source_url");
        var groups=uniqueStrings(node.get("sourceGroups"),1,5,32);require(policy.groups().containsAll(groups),"source_scope");
        require(policy.grant().equals(text(node.get("permissionRef"),128)),"permission_scope");
        text(node.get("mappingRevision"),128);text(node.get("extractorVersion"),128);
        try { Instant.parse(text(node.get("retrievedAt"),64)); } catch(Exception failure) { throw fail("retrieved_at"); }
        if(!node.get("originalPublisher").isNull()) {
            var publisher=node.get("originalPublisher");object(publisher,Set.of("name"),Set.of("url"));text(publisher.get("name"),200);
            if(publisher.has("url")&&!publisher.get("url").isNull())referenceUrl(publisher.get("url"));
        }
        var refs=node.get("originalReferences");require(refs.isArray()&&refs.size()<=32,"source_references");
        for(var ref:refs) {
            object(ref,Set.of("publisher","label","url","year","examNumber"),Set.of());text(ref.get("label"),500);
            if(!ref.get("publisher").isNull())text(ref.get("publisher"),200);
            if(!ref.get("url").isNull())referenceUrl(ref.get("url"));
            if(!ref.get("year").isNull())integer(ref.get("year"),1900,2100);
            if(!ref.get("examNumber").isNull())integer(ref.get("examNumber"),1,30);
        }
    }
    private void referenceUrl(JsonNode node) { require(safeUrl(text(node,2048),Set.of("3.shkolkovo.online","math-ege.sdamgia.ru","doc.fipi.ru","fipi.ru","statgrad.org")).getRawQuery()==null,"source_url"); }
    private URI safeUrl(String text,Set<String> hosts) {
        try { URI url=URI.create(text);require("https".equals(url.getScheme())&&hosts.contains(url.getHost())&&url.getUserInfo()==null&&url.getFragment()==null&&(url.getPort()==-1||url.getPort()==443),"source_url");return url; }
        catch(IllegalArgumentException failure) { throw fail("source_url"); }
    }
    private void blocks(JsonNode nodes,String purpose,Map<String,Asset> assets,Set<String> used,int[] counts,boolean required,List<ImportMathValidator.Formula> formulas) {
        require(nodes.isArray()&&nodes.size()<=(required?128:256)&&(!required||!nodes.isEmpty()),"content_blocks");int totalRuns=0;
        for(var block:nodes) {
            require(block.isObject()&&block.has("type"),"block_type");String type=text(block.get("type"),16);
            if(type.equals("text")||type.equals("latex")) {
                object(block,Set.of("type","value"),Set.of());String value=text(block.get("value"),type.equals("latex")?4000:16000);if(type.equals("latex"))formulas.add(new ImportMathValidator.Formula(value,true));
            } else if(type.equals("image")) {
                object(block,Set.of("type","assetId","alt"),Set.of("aspectRatio"));text(block.get("alt"),1000);if(block.has("aspectRatio"))decimal(block.get("aspectRatio"),0.01,100);
                use(block,purpose,assets,used);counts[1]++;
            } else if(type.equals("paragraph")) {
                object(block,Set.of("type","runs"),Set.of());var runs=block.get("runs");require(runs.isArray()&&!runs.isEmpty(),"paragraph_runs");totalRuns+=runs.size();require(totalRuns<=1024,"paragraph_runs");
                for(var run:runs) {
                    require(run.isObject()&&run.has("type"),"run_type");String runType=text(run.get("type"),16);
                    if(runType.equals("text")||runType.equals("latex")) {
                        object(run,Set.of("type","value"),Set.of());String value=runType.equals("latex")?text(run.get("value"),4000):runText(run.get("value"));if(runType.equals("latex"))formulas.add(new ImportMathValidator.Formula(value,false));
                    } else if(runType.equals("formula")) {
                        object(run,Set.of("type","assetId"),Set.of("alt","heightEm","baselineEm"));if(run.has("alt"))text(run.get("alt"),1000);
                        if(run.has("heightEm"))decimal(run.get("heightEm"),0.05,20);if(run.has("baselineEm"))decimal(run.get("baselineEm"),-10,10);
                        use(run,purpose,assets,used);counts[0]++;
                    } else throw fail("run_type");
                }
            } else throw fail("block_type");
        }
    }
    private void use(JsonNode block,String purpose,Map<String,Asset> assets,Set<String> used) {
        String id=text(block.get("assetId"),128);Asset asset=assets.get(id);require(asset!=null&&asset.purpose().equals(purpose),"asset_scope");used.add(id);
    }
    private byte[] assetBytes(Path root,String relative) {
        try {
            Path path=Path.of(relative);require(!path.isAbsolute()&&!relative.contains("\\")&&path.getNameCount()>0,"asset_path");
            for(Path part:path)require(!part.toString().equals("..")&&!part.toString().equals("."),"asset_path");
            Path base=root.toRealPath(),current=base;
            for(Path part:path) { current=current.resolve(part);require(!Files.isSymbolicLink(current),"asset_path"); }
            require(current.toRealPath().startsWith(base)&&Files.isRegularFile(current,LinkOption.NOFOLLOW_LINKS)&&Files.size(current)<=8388608,"asset_path");
            try(var stream=Files.newInputStream(current)) { byte[] bytes=stream.readNBytes(8388609);require(bytes.length<=8388608,"asset_size");return bytes; }
        } catch(ImportFailure failure) { throw failure; } catch(Exception failure) { throw fail("asset_path"); }
    }
    public static String hash(byte[] bytes) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch(Exception failure) { throw new IllegalStateException(); } }
    public static Object plain(JsonNode node,Map<String,Asset> assets) {
        if(node.isObject()) { Map<String,Object> map=new TreeMap<>();for(var entry:node.properties())map.put(entry.getKey(),entry.getKey().equals("assetId")&&assets.containsKey(entry.getValue().asText())?assets.get(entry.getValue().asText()).hash():plain(entry.getValue(),assets));return map; }
        if(node.isArray()) { var list=new ArrayList<Object>();node.forEach(value->list.add(plain(value,assets)));return list; }
        if(node.isNull())return null;if(node.isBoolean())return node.asBoolean();if(node.isIntegralNumber())return node.asLong();if(node.isNumber())return node.asDouble();return node.asText();
    }
    private String projection(JsonNode blocks) {
        StringBuilder value=new StringBuilder();for(var block:blocks) { if(!value.isEmpty())value.append('\n');if(block.has("value"))value.append(block.get("value").asText());else if(block.has("runs"))for(var run:block.get("runs"))if(run.has("value"))value.append(run.get("value").asText()); }
        return compact(value.toString());
    }
    private String compact(String value) { return value.strip().replaceAll("\\s+"," "); }
    private String runText(JsonNode node) { require(node!=null&&node.isTextual()&&node.asText().length()<=16000&&!node.asText().contains("\u0000"),"string_value");return node.asText(); }
    private List<String> uniqueStrings(JsonNode nodes,int min,int max,int length) {
        require(nodes.isArray()&&nodes.size()>=min&&nodes.size()<=max,"array_limit");var result=new ArrayList<String>();for(var node:nodes)result.add(text(node,length));require(new HashSet<>(result).size()==result.size(),"duplicate_value");return result;
    }
    private int integer(JsonNode node,int min,int max) { require(node!=null&&node.isIntegralNumber()&&node.canConvertToInt()&&node.asInt()>=min&&node.asInt()<=max,"integer_value");return node.asInt(); }
    private void decimal(JsonNode node,double min,double max) { require(node.isNumber()&&Double.isFinite(node.asDouble())&&node.asDouble()>=min&&node.asDouble()<=max,"numeric_value"); }
    private String text(JsonNode node,int max) { require(node!=null&&node.isTextual()&&!node.asText().isBlank()&&node.asText().length()<=max&&!node.asText().contains("\u0000"),"string_value");return node.asText(); }
    private void object(JsonNode node,Set<String> required,Set<String> optional) {
        require(node!=null&&node.isObject(),"object_value");for(String key:required)require(node.has(key),"missing_field");for(var field:node.properties())require(required.contains(field.getKey())||optional.contains(field.getKey()),"unknown_field");
    }
    private static void require(boolean value,String code) { if(!value)throw fail(code); }
    private static ImportFailure fail(String code) { return new ImportFailure(code); }
}
