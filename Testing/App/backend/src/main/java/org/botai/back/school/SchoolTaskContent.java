package org.botai.back.school;

import java.util.*;
import lombok.RequiredArgsConstructor;
import org.botai.back.common.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Actor routes are projected at read time; immutable shared task content never grants media access. */
@Component
@RequiredArgsConstructor
public class SchoolTaskContent {
 private final JdbcTemplate db;private final JsonCodec json;
 public JsonNode project(UUID task,String prefix){var source=json.read(db.queryForObject("SELECT content::text FROM school_tasks WHERE id=?",String.class,task));var allowed=new HashSet<>(db.queryForList("SELECT id::text FROM school_task_assets WHERE task_id=? AND kind='statement'",String.class,task));var result=new ArrayList<Object>();for(JsonNode block:source){String type=block.path("type").asText();if(Set.of("text","latex").contains(type)){result.add(Map.of("type",type,"value",block.path("value").asText(block.path("text").asText())));}else if(type.equals("image")){String id=block.path("assetId").asText();if(id.isEmpty()){String src=block.path("src").asText();id=src.substring(src.lastIndexOf('/')+1);}if(allowed.contains(id)){var image=new LinkedHashMap<String,Object>();image.put("type","image");image.put("src",prefix+id);image.put("alt",block.path("alt").asText("Условие задания"));if(block.path("aspectRatio").isNumber())image.put("aspectRatio",block.get("aspectRatio"));result.add(image);}}else if(type.equals("paragraph")){var runs=new ArrayList<Object>();for(JsonNode run:block.path("runs"))if(Set.of("text","latex").contains(run.path("type").asText()))runs.add(Map.of("type",run.path("type").asText(),"value",run.path("value").asText()));if(!runs.isEmpty())result.add(Map.of("type","paragraph","runs",runs));}}return json.read(json.write(result));}
}
