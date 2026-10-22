package org.botai.back.school;

import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/school")
@RequiredArgsConstructor
public class SchoolController {
 private final SchoolService service;
 @GetMapping("/me") public Object me(Authentication a){return service.me(a);}
 @GetMapping("/assignments") public Object list(Authentication a,@RequestParam(required=false)Integer limit,@RequestParam(required=false)String cursor){return service.list(a,limit,cursor);}
 @GetMapping("/assignments/{id}") public Object detail(Authentication a,@PathVariable UUID id){return service.detail(a,id);}
 @PostMapping("/assignments/{id}/submissions") public Object create(Authentication a,@PathVariable UUID id,@RequestHeader("Idempotency-Key")String key,@RequestBody SchoolService.Create request){var outcome=service.createOutcome(a,id,key,request);return ResponseEntity.status(outcome.created()?201:200).body(outcome.document());}
 @PostMapping("/assignments/{id}/submissions/{submission}/fixture") public Object fixture(Authentication a,@PathVariable UUID id,@PathVariable UUID submission){return service.fixture(a,id,submission);}
 @GetMapping("/assignments/{id}/result") public Object result(Authentication a,@PathVariable UUID id){return service.result(a,id);}
 @GetMapping("/assignments/{id}/task-media/{asset}") public ResponseEntity<byte[]> media(Authentication a,@PathVariable UUID id,@PathVariable UUID asset){var image=service.taskMedia(a,id,asset);return ResponseEntity.ok().header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(image.mimeType())).body(image.bytes());}
}
