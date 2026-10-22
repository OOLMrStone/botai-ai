package org.botai.back.b2b;

import java.util.*;
import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.botai.back.media.*;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartHttpServletRequest;

@RestController
@RequestMapping("/api/local-demo")
@RequiredArgsConstructor
public class LocalDemoController {
    private static final tools.jackson.databind.json.JsonMapper PUBLIC_JSON=tools.jackson.databind.json.JsonMapper.builder().build();
    private final LocalDemoService service;
    @GetMapping("/runs") public ResponseEntity<Object> list(Authentication auth,@RequestParam(required=false)String origin,@RequestParam(required=false)String status,@RequestParam(required=false)Integer limit,@RequestParam(required=false)String cursor){return json(service.list(auth,origin,status,limit,cursor),200);}
    @GetMapping("/runs/{id}") public ResponseEntity<Object> detail(Authentication auth,@PathVariable UUID id){return json(service.detail(auth,id),200);}
    @GetMapping("/runs/{id}/events") public ResponseEntity<Object> events(Authentication auth,@PathVariable UUID id,@RequestParam(defaultValue="0")long after,@RequestParam(defaultValue="100")int limit){return json(service.events(auth,id,after,limit),200);}
    @PostMapping(value="/runs/manual",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) public ResponseEntity<Object> manual(Authentication auth,@RequestHeader("Idempotency-Key")String key,MultipartHttpServletRequest request){
        service.operator(auth);var fields=request.getParameterMap();if(fields.size()!=1||!fields.containsKey("task_number")||fields.get("task_number").length!=1||!fields.get("task_number")[0].matches("14|15|16|17|18|19|20"))throw ApiException.invalid("Некорректный номер задания");var files=request.getMultiFileMap();if(!files.keySet().equals(Set.of("task_image","solution_images"))||files.get("task_image").size()!=1||files.get("solution_images").isEmpty()||files.get("solution_images").size()>4)throw ApiException.invalid("Нужны условие и от одного до четырёх фото решения");var created=service.manual(auth,key,Integer.parseInt(fields.get("task_number")[0]),files.getFirst("task_image"),files.get("solution_images"));return json(service.detail(auth,created.runId()),created.replay()?200:202);
    }
    @GetMapping("/runs/{id}/images/{image}/preview") public ResponseEntity<byte[]> image(Authentication auth,@PathVariable UUID id,@PathVariable UUID image){return image(service.image(auth,id,image,false));}
    @GetMapping("/runs/{id}/task-media/{image}") public ResponseEntity<byte[]> taskMedia(Authentication auth,@PathVariable UUID id,@PathVariable UUID image){return image(service.image(auth,id,image,true));}
    @GetMapping("/runs/{id}/task-input/{image}/preview") public ResponseEntity<byte[]> task(Authentication auth,@PathVariable UUID id,@PathVariable UUID image){return image(service.image(auth,id,image,true));}
    @GetMapping("/runs/{id}/image-artifacts/{artifact}/preview") public ResponseEntity<byte[]> artifact(Authentication auth,@PathVariable UUID id,@PathVariable UUID artifact){return image(service.artifact(auth,id,artifact));}
    @GetMapping("/runs/{id}/documents/{document}/download") public ResponseEntity<byte[]> document(Authentication auth,@PathVariable UUID id,@PathVariable UUID document){return SolutionDocumentController.download(service.document(auth,id,document));}
    private static ResponseEntity<Object> json(Object value,int status){return ResponseEntity.status(status).header("Cache-Control","private, no-store").body(PUBLIC_JSON.valueToTree(value));}
    private static ResponseEntity<byte[]> image(MediaService.Content image){return ResponseEntity.ok().header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(image.mimeType())).body(image.bytes());}
}
