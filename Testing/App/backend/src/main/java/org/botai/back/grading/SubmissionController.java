package org.botai.back.grading;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.botai.back.security.CurrentActor;
import org.botai.back.media.MediaService;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.multipart.MultipartFile;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class SubmissionController {
    private final CurrentActor actors;private final SubmissionService service;private final SubmissionStore store;private final MediaService media;
    @PostMapping("/api/submissions") public Object create(Authentication a,@RequestHeader("Idempotency-Key")String key,@Valid @RequestBody SubmissionService.Intent request){return service.create(actors.require(a).getId(),key,request);}
    @GetMapping("/api/submissions/{id}") public Object get(Authentication a,@PathVariable UUID id){return store.get(actors.require(a).getId(),id);}
    @PostMapping("/api/submissions/{id}/images") public Object image(Authentication a,@PathVariable UUID id,@RequestParam MultipartFile file){return media.upload(actors.require(a).getId(),id,file);}
    @DeleteMapping("/api/submissions/{id}/images/{imageId}") public void delete(Authentication a,@PathVariable UUID id,@PathVariable UUID imageId){media.delete(actors.require(a).getId(),id,imageId);}
    @PostMapping("/api/submissions/{id}/finalize") public Object finish(Authentication a,@PathVariable UUID id,@Valid @RequestBody SubmissionService.Finalize request){return service.finalizeSubmission(actors.require(a).getId(),id,request.expectedRevision());}
    @PostMapping("/api/submissions/{id}/client-rejection") public Object reject(Authentication a,@PathVariable UUID id,@Valid @RequestBody SubmissionService.ClientRejection request){return service.report(actors.require(a).getId(),id,request);}
    @PostMapping("/api/submissions/{id}/cancel") public Object cancel(Authentication a,@PathVariable UUID id){return service.cancel(actors.require(a).getId(),id);}
    @PostMapping("/api/attempts/{id}/checks") public Object check(Authentication a,@PathVariable UUID id,@RequestHeader("Idempotency-Key")String key,@Valid @RequestBody SubmissionService.Check request){return service.checks(actors.require(a).getId(),id,key,request);}
}
