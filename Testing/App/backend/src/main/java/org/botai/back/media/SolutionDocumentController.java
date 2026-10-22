package org.botai.back.media;

import lombok.RequiredArgsConstructor;
import org.botai.back.security.CurrentActor;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class SolutionDocumentController {
    private final CurrentActor actors;
    private final SolutionDocumentService documents;
    @PostMapping("/api/submissions/{id}/documents") @ResponseStatus(HttpStatus.ACCEPTED)
    public Object upload(Authentication auth,@PathVariable UUID id,@RequestParam MultipartFile file) {return documents.upload(actors.require(auth).getId(),id,file);}
    @GetMapping("/api/submissions/{id}/documents/{documentId}/download")
    public ResponseEntity<byte[]> download(Authentication auth,@PathVariable UUID id,@PathVariable UUID documentId) {return download(documents.original(actors.require(auth).getId(),id,documentId));}
    @DeleteMapping("/api/submissions/{id}/documents/{documentId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(Authentication auth,@PathVariable UUID id,@PathVariable UUID documentId) {documents.delete(actors.require(auth).getId(),id,documentId);}
    public static ResponseEntity<byte[]> download(SolutionDocumentService.Original value) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).header("Content-Disposition",ContentDisposition.attachment().filename(value.fileName(),java.nio.charset.StandardCharsets.UTF_8).build().toString())
            .header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").header("Content-Security-Policy","sandbox; default-src 'none'; frame-ancestors 'none'").body(value.bytes());
    }
}
