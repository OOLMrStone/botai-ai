package org.botai.back.expert;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class ExpertController {
    private final ExpertService service;
    private final ExpertGradingCoordinator grading;
    @GetMapping("/api/expert/me") public Object me(Authentication auth) { return service.me(auth); }
    @GetMapping("/api/expert/notifications") public Object notifications(Authentication auth,@RequestParam(defaultValue="0")long after,@RequestParam(required=false)Integer limit){return service.notifications(auth,after,limit);}
    @PostMapping("/api/expert/notifications/{id}/read") public ResponseEntity<Void> readNotification(Authentication auth,@PathVariable UUID id){service.readNotification(auth,id);return ResponseEntity.noContent().build();}
    @GetMapping("/api/expert/works/{id}/task-media/{asset}") public ResponseEntity<byte[]> taskMedia(Authentication auth,@PathVariable UUID id,@PathVariable UUID asset){var image=service.taskMedia(auth,id,asset);return ResponseEntity.ok().header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(image.mimeType())).body(image.bytes());}
    @GetMapping("/api/expert/students") public Object students(Authentication auth, @RequestParam(required=false) Integer limit, @RequestParam(required=false) String cursor) { return service.students(auth, limit, cursor); }
    @PostMapping("/api/expert/students") public Object assign(Authentication auth, @Valid @RequestBody ExpertDtos.Assign request) { return service.assign(auth, request.studentId()); }
    @GetMapping("/api/expert/works") public Object works(Authentication auth, @RequestParam(required=false) String status, @RequestParam(required=false) UUID studentId, @RequestParam(required=false) Integer limit, @RequestParam(required=false) String cursor) { return service.works(auth, status, studentId, limit, cursor); }
    @GetMapping("/api/expert/works/{id}") public Object work(Authentication auth, @PathVariable UUID id) { return service.work(auth, id); }
    @PutMapping("/api/expert/works/{id}/draft") public Object draft(Authentication auth, @PathVariable UUID id, @Valid @RequestBody ExpertDtos.Save request) { return service.save(auth, id, request, false); }
    @PostMapping("/api/expert/works/{id}/send") public Object send(Authentication auth, @PathVariable UUID id, @Valid @RequestBody ExpertDtos.Save request) { return service.save(auth, id, request, true); }
    @PostMapping("/api/expert/works/{id}/manual-grade") public Object manualGrade(Authentication auth, @PathVariable UUID id, @Valid @RequestBody ExpertDtos.Save request) { return service.manualGrade(auth, id, request); }
    @PostMapping("/api/expert/works/{id}/grade") public Object grade(Authentication auth, @PathVariable UUID id, @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody ExpertDtos.Save request) { return grading.grade(auth, id, key, request); }
    @GetMapping("/api/expert/works/{id}/grade-jobs/{jobId}") public Object gradeJob(Authentication auth, @PathVariable UUID id, @PathVariable UUID jobId) { return service.gradeJob(auth, id, jobId); }
    @GetMapping("/api/expert/works/{id}/documents/{documentId}") public ResponseEntity<byte[]> original(Authentication auth,@PathVariable UUID id,@PathVariable UUID documentId) {return org.botai.back.media.SolutionDocumentController.download(service.originalDocument(auth,id,documentId));}
    @GetMapping("/api/expert/works/{id}/images/{imageId}") public ResponseEntity<byte[]> image(Authentication auth, @PathVariable UUID id, @PathVariable UUID imageId) {
        var image = service.image(auth, id, imageId);
        return ResponseEntity.ok().header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").contentType(MediaType.parseMediaType(image.mimeType())).body(image.bytes());
    }
    @PostMapping("/api/submissions/{id}/expert-review") public Object route(Authentication auth, @PathVariable UUID id, @Valid @RequestBody ExpertDtos.Route request) { return service.route(auth, id, request.schoolId()); }
    @GetMapping("/api/submissions/{id}/expert-review") public Object review(Authentication auth, @PathVariable UUID id, @RequestParam UUID schoolId) { return service.studentReview(auth, id, schoolId); }
}
