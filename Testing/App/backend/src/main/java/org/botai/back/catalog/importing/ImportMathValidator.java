package org.botai.back.catalog.importing;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Component
public class ImportMathValidator {
    private final String node;
    private final String script;
    private final String katexPackage;
    private static final int CACHE_ENTRIES=20_000,CACHE_BYTES=8*1024*1024;
    private static final int BATCH_ENTRIES=128,BATCH_BYTES=65_536;
    private static final JsonMapper JSON=JsonMapper.builder().build();
    private final LinkedHashMap<String,Integer> validated=new LinkedHashMap<>();
    private int cachedBytes;
    public record Formula(String value,boolean displayMode) { }
    public ImportMathValidator(@Value("${app.content-import.node:}") String node,@Value("${app.content-import.math-validator:}") String script,@Value("${app.content-import.katex-package:}") String katexPackage) { this.node=node;this.script=script;this.katexPackage=katexPackage; }
    public void validate(String value) { validate(value,false); }
    public void validate(String value,boolean displayMode) { validateAll(List.of(new Formula(value,displayMode))); }
    public synchronized void validateAll(List<Formula> formulas) {
        if(formulas.size()>4096)throw new ImportFailure("invalid_math");
        var pending=new LinkedHashMap<String,Formula>();
        for(var formula:formulas) {
            if(formula==null||formula.value()==null||formula.value().isEmpty()||formula.value().length()>4000||formula.value().getBytes(StandardCharsets.UTF_8).length>16000)throw new ImportFailure("invalid_math");
            if(!validated.containsKey(key(formula)))pending.putIfAbsent(key(formula),formula);
        }
        if(pending.isEmpty())return;
        if(node.isBlank()||script.isBlank()||katexPackage.isBlank()||!Path.of(node).isAbsolute()||!Path.of(script).isAbsolute()||!Path.of(katexPackage).isAbsolute())throw new ImportFailure("math_validator_required");
        var batch=new ArrayList<Formula>();int bytes=2;
        for(var formula:pending.values()) {
            int cost=JSON.writeValueAsBytes(formula).length+1;
            if(!batch.isEmpty()&&(batch.size()>=BATCH_ENTRIES||bytes+cost>BATCH_BYTES)) {
                validateBatch(batch);batch.clear();bytes=2;
            }
            batch.add(formula);bytes+=cost;
        }
        if(!batch.isEmpty())validateBatch(batch);
    }
    private static String key(Formula formula) { return (formula.displayMode()?"D:":"I:")+formula.value(); }
    private void validateBatch(List<Formula> batch) {
        byte[] payload=JSON.writeValueAsBytes(batch);
        if(payload.length>BATCH_BYTES)throw new ImportFailure("invalid_math");
        Process process=null;
        try {
            var builder=new ProcessBuilder(node,script).redirectError(ProcessBuilder.Redirect.DISCARD).redirectOutput(ProcessBuilder.Redirect.DISCARD);
            builder.environment().clear();builder.environment().put("BOTAI_KATEX_PACKAGE",katexPackage);builder.environment().put("BOTAI_KATEX_BATCH","true");process=builder.start();
            // The writer shares the same deadline as the child: a stalled stdin cannot block an import.
            final Process child=process;
            var writing=java.util.concurrent.CompletableFuture.runAsync(()-> {
                try(var input=child.getOutputStream()) { input.write(payload); }
                catch(java.io.IOException failure) { throw new java.io.UncheckedIOException(failure); }
            });
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            writing.get(5,TimeUnit.SECONDS);
            long remaining=deadline-System.nanoTime();
            if(remaining<=0||!process.waitFor(remaining,TimeUnit.NANOSECONDS)||process.exitValue()!=0)throw new ImportFailure("invalid_math");
            for(var formula:batch) {
                int cost=formula.value().length()*2+64;
                while(validated.size()>=CACHE_ENTRIES||cachedBytes+cost>CACHE_BYTES) {
                    var oldest=validated.entrySet().iterator();var entry=oldest.next();cachedBytes-=entry.getValue();oldest.remove();
                }
                validated.put(key(formula),cost);cachedBytes+=cost;
            }
        } catch(ImportFailure failure) { throw failure; }
        catch(java.util.concurrent.TimeoutException failure) { throw new ImportFailure("invalid_math"); }
        catch(Exception failure) { throw new ImportFailure("math_validator_unavailable"); }
        finally { if(process!=null&&process.isAlive())process.destroyForcibly(); }
    }
}
