package org.botai.back.catalog.importing;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.JsonCodec;
import org.botai.back.media.port.ObjectStorage;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ContentPublisher {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final JsonCodec json;
    private final ImportPackageValidator validator;
    private final ObjectStorage storage;
    public record Outcome(String state,UUID version) { }
    public record Report(UUID run,int published,int noop,int quarantined,Map<String,Integer> quarantineReasons) { }
    private record Candidate(JsonNode node,String reason) { }
    private record Upload(UUID id,String key) { }

    public Report importFile(Path manifest,Path packageRoot,boolean publish) {
        List<Candidate> candidates=new ArrayList<>();Map<String,Integer> identities=new HashMap<>();String hash;
        try {
            if(!Files.isRegularFile(manifest)||Files.size(manifest)>67108864)throw new ImportFailure("manifest_limit");
            try(var input=Files.newInputStream(manifest)) { var digest=java.security.MessageDigest.getInstance("SHA-256");byte[] block=new byte[65536];int count;while((count=input.read(block))!=-1)digest.update(block,0,count);hash=HexFormat.of().formatHex(digest.digest()); }
            try(var input=Files.newBufferedReader(manifest,StandardCharsets.UTF_8)) {
                String line;while((line=input.readLine())!=null) {
                    if(candidates.size()>=1000)throw new ImportFailure("manifest_limit");
                    try { JsonNode node=validator.parse(line);String identity=identity(node);identities.merge(identity,1,Integer::sum);candidates.add(new Candidate(node,null)); }
                    catch(ImportFailure failure) { candidates.add(new Candidate(null,failure.getMessage())); }
                }
            }
            if(candidates.isEmpty())throw new ImportFailure("empty_manifest");
        } catch(ImportFailure failure) { throw failure; } catch(Exception failure) { throw new ImportFailure("manifest_read"); }
        UUID run=UUID.randomUUID();int[] counts=new int[3];Map<String,Integer> reasons=new TreeMap<>();
        if(publish)db.update("INSERT INTO content_import_runs(id,manifest_sha256,state) VALUES(?,?,'running')",run,hash);
        for(int ordinal=0;ordinal<candidates.size();ordinal++) {
            Candidate candidate=candidates.get(ordinal);Outcome outcome=null;String reason=candidate.reason();
            if(reason==null) {
                try {
                    if(identities.get(identity(candidate.node()))>1)throw new ImportFailure("duplicate_identity");
                    var prepared=validator.validate(candidate.node(),packageRoot);validateTopics(prepared.source());
                    outcome=publish?publish(prepared):new Outcome("noop",null);
                } catch(ImportFailure failure) {
                    if(failure.getMessage().equals("publication_uncertain")) {
                        if(publish)try { db.update("UPDATE content_import_runs SET state='failed',finished_at=now() WHERE id=?",run); }catch(Exception ignored) { }
                        throw failure;
                    }
                    reason=failure.getMessage();
                }
                catch(Exception failure) { reason="publication_failed"; }
            }
            String state=reason==null?outcome.state():"quarantined";
            if(reason!=null)reasons.merge(reason.matches("[a-z_]{1,64}")?reason:"validation_failed",1,Integer::sum);
            counts[state.equals("published")?0:state.equals("noop")?1:2]++;
            if(publish)db.update("INSERT INTO content_import_items(run_id,ordinal,provider,external_id,state,reason,task_version_id) VALUES(?,?,?,?,?,?,?)",run,ordinal,safe(candidate.node(),"provider"),safe(candidate.node(),"externalId"),state,reason,outcome==null?null:outcome.version());
        }
        if(publish)db.update("UPDATE content_import_runs SET state='completed',finished_at=now() WHERE id=?",run);
        return new Report(run,counts[0],counts[1],counts[2],Map.copyOf(reasons));
    }
    public Outcome publish(ImportPackageValidator.Prepared prepared) {
        List<Upload> uploads=new ArrayList<>();
        try {
            return tx.execute(status->{
                JsonNode root=prepared.source();String provider=root.get("provider").asText(),external=root.get("externalId").asText();
                long lock=Long.parseUnsignedLong(JsonCodec.sha256(provider+":"+external).substring(0,16),16);
                db.execute("SELECT pg_advisory_xact_lock("+lock+")");
                validateTopics(root);
                var tasks=db.queryForList("SELECT task_id FROM task_source_links WHERE provider=? AND external_id=?",provider,external);
                UUID task;
                if(tasks.isEmpty()) {
                    task=UUID.randomUUID();db.update("INSERT INTO tasks(id) VALUES(?)",task);
                    db.update("INSERT INTO task_source_links(provider,external_id,task_id) VALUES(?,?,?)",provider,external,task);
                } else task=(UUID)tasks.getFirst().get("task_id");
                db.queryForList("SELECT id FROM tasks WHERE id=? FOR UPDATE",task);
                var prior=db.queryForList("SELECT task_version_id FROM task_version_provenance WHERE task_id=? AND version_fingerprint=?",task,prepared.versionHash());
                if(!prior.isEmpty())return new Outcome("noop",(UUID)prior.getFirst().get("task_version_id"));
                Map<String,UUID> assetIds=new HashMap<>();
                Map<String,ImportPackageValidator.Asset> metadata=new HashMap<>();
                for(var asset:prepared.assets()) {
                    UUID id=UUID.randomUUID();String key="catalog/"+UUID.randomUUID()+".png";uploads.add(new Upload(id,key));assetIds.put(asset.id(),id);
                    metadata.put(asset.id(),asset);
                    var intent=new TransactionTemplate(tx.getTransactionManager());intent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
                    intent.executeWithoutResult(ignored->db.update("INSERT INTO catalog_assets(id,bucket,object_key,state,purpose,mime_type,size_bytes,width,height,original_sha256,normalized_sha256) VALUES(?,?,?,'staged',?,?,?,?,?,?,?)",id,storage.bucket(),key,asset.purpose(),asset.image().mimeType(),asset.image().bytes().length,asset.image().width(),asset.image().height(),asset.rawHash(),asset.hash()));
                    storage.put(key,asset.image().bytes(),asset.image().mimeType());
                    if(db.update("UPDATE catalog_assets SET state='ready' WHERE id=? AND state='staged'",id)!=1)throw new ImportFailure("asset_state");
                }
                UUID version=UUID.randomUUID();int next=db.queryForObject("SELECT coalesce(max(version),0)+1 FROM task_versions WHERE task_id=?",Integer.class,task);
                String content=json.write(publicBlocks(root.get("content"),assetIds,metadata,"statement"));
                Object reference=root.has("referenceContent")?publicBlocks(root.get("referenceContent"),assetIds,metadata,"reference"):List.of();
                Object answerContent=root.has("referenceAnswerContent")?publicBlocks(root.get("referenceAnswerContent"),assetIds,metadata,"reference"):List.of();
                Object sources=sources(root);
                db.update("INSERT INTO task_versions(id,task_id,version,format_id,exam_number,difficulty,difficulty_level,source_year,content,statement,reference_answer,reference_solution,is_demo,sources,reference_content,reference_answer_content,ai_input_ready) VALUES(?,?,?,?,?,?,?,?,?::jsonb,?,?,?,false,?::jsonb,?::jsonb,?::jsonb,?)",version,task,next,root.get("formatId").asText(),root.get("examNumber").asInt(),root.get("difficulty").isTextual()?root.get("difficulty").asText():null,root.get("difficulty").isIntegralNumber()?root.get("difficulty").asInt():null,root.get("sourceYear").isNull()?null:root.get("sourceYear").asInt(),content,root.get("statement").asText(),root.get("referenceAnswer").isNull()?null:root.get("referenceAnswer").asText(),root.get("referenceSolution").isNull()?null:root.get("referenceSolution").asText(),json.write(sources),json.write(reference),json.write(answerContent),prepared.aiReady());
                for(var answer:root.get("acceptedAnswers"))db.update("INSERT INTO task_version_answers(task_version_id,answer) VALUES(?,?)",version,answer.asText());
                for(var topic:root.get("topicIds"))db.update("INSERT INTO task_version_topics(task_version_id,topic_id) VALUES(?,?)",version,topic.asText());
                db.update("INSERT INTO task_version_provenance(task_version_id,task_id,content_fingerprint,version_fingerprint,snapshot) VALUES(?,?,?,?,?::jsonb)",version,task,prepared.contentHash(),prepared.versionHash(),json.write(root.get("provenance")));
                for(UUID asset:assetIds.values())db.update("INSERT INTO task_version_assets(task_version_id,asset_id) VALUES(?,?)",version,asset);
                db.update("UPDATE tasks SET current_version_id=? WHERE id=?",version,task);
                return new Outcome("published",version);
            });
        } catch(Exception failure) {
            for(var upload:uploads)deleteClaimed(upload);
            if(failure instanceof ImportFailure rejected)throw rejected;
            try {
                var root=prepared.source();var committed=db.queryForList("SELECT p.task_version_id FROM task_version_provenance p JOIN task_source_links s ON s.task_id=p.task_id WHERE s.provider=? AND s.external_id=? AND p.version_fingerprint=?",root.get("provider").asText(),root.get("externalId").asText(),prepared.versionHash());
                if(!committed.isEmpty())return new Outcome("noop",(UUID)committed.getFirst().get("task_version_id"));
            }catch(Exception unavailable) { throw new ImportFailure("publication_uncertain"); }
            throw new ImportFailure("publication_failed");
        }
    }
    private void validateTopics(JsonNode root) {
        for(var topic:root.get("topicIds"))if(db.queryForObject("SELECT count(*) FROM topics WHERE id=? AND format_id=? AND exam_number=? AND active",Integer.class,topic.asText(),root.get("formatId").asText(),root.get("examNumber").asInt())!=1)throw new ImportFailure("topic_mapping");
        int number=root.get("examNumber").asInt();
        if(number==20&&root.get("topicIds").size()!=1)throw new ImportFailure("topic_mapping");
    }
    private Object sources(JsonNode root) {
        JsonNode provenance=root.get("provenance");Map<String,Object> source=new LinkedHashMap<>();source.put("provider",root.get("provider").asText());
        for(String field:List.of("sourceUrl","originalPublisher","originalReferences"))source.put(field,ImportPackageValidator.plain(provenance.get(field),Map.of()));
        return List.of(source);
    }
    private Object publicBlocks(JsonNode node,Map<String,UUID> assets,Map<String,ImportPackageValidator.Asset> metadata,String purpose) {
        if(node.isArray()) { var list=new ArrayList<Object>();node.forEach(value->list.add(publicBlocks(value,assets,metadata,purpose)));return list; }
        if(node.isObject()) {
            var map=new LinkedHashMap<String,Object>();for(var entry:node.properties()) {
                if(entry.getKey().equals("assetId"))map.put("src",(purpose.equals("statement")?"/api/catalog-media/":"/api/catalog-reference-media/")+assets.get(entry.getValue().asText()));
                else map.put(entry.getKey(),publicBlocks(entry.getValue(),assets,metadata,purpose));
            }
            if(node.has("assetId")) { var image=metadata.get(node.get("assetId").asText()).image();map.put("width",image.width());map.put("height",image.height());if(node.path("type").asText().equals("image")&&!map.containsKey("aspectRatio"))map.put("aspectRatio",(double)image.width()/image.height()); }
            return map;
        }
        return ImportPackageValidator.plain(node,Map.of());
    }
    public void reapStaged() {
        for(var row:db.queryForList("SELECT id,object_key FROM catalog_assets WHERE state IN('staged','failed') AND created_at<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM task_version_assets WHERE asset_id=catalog_assets.id) ORDER BY created_at LIMIT 100"))deleteClaimed(new Upload((UUID)row.get("id"),(String)row.get("object_key")));
    }
    private void deleteClaimed(Upload upload) {
        try {
            var claim=new TransactionTemplate(tx.getTransactionManager());claim.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            boolean accepted=Boolean.TRUE.equals(claim.execute(ignored->db.update("UPDATE catalog_assets SET state='failed' WHERE id=? AND object_key=? AND state IN('staged','failed') AND NOT EXISTS(SELECT 1 FROM task_version_assets WHERE asset_id=catalog_assets.id)",upload.id(),upload.key())==1));
            // If commit is uncertain or the row became ready, preserve the object for reconciliation.
            if(accepted) { storage.delete(upload.key());db.update("UPDATE catalog_assets SET state='deleted' WHERE id=? AND state='failed' AND NOT EXISTS(SELECT 1 FROM task_version_assets WHERE asset_id=catalog_assets.id)",upload.id()); }
        }catch(Exception ignored) { }
    }
    private String identity(JsonNode node) {
        String provider=safe(node,"provider"),external=safe(node,"externalId");if(provider==null||external==null)throw new ImportFailure("invalid_identity");return provider+":"+external;
    }
    private String safe(JsonNode node,String field) { if(node==null||!node.has(field)||!node.get(field).isTextual())return null;String value=node.get(field).asText();return value.matches("[a-zA-Z0-9._-]{1,64}")?value:null; }
}
