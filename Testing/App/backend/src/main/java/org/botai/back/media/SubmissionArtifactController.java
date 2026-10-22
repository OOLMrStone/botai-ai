package org.botai.back.media;

import lombok.RequiredArgsConstructor;
import org.botai.back.security.CurrentActor;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class SubmissionArtifactController {
    private final SubmissionArtifactService artifacts;private final CurrentActor actors;
    @PostMapping("/api/expert/works/{work}/artifacts/crops") @ResponseStatus(HttpStatus.CREATED)
    public Object create(Authentication auth,@PathVariable UUID work,@RequestBody SubmissionArtifactService.Proposal proposal){return artifacts.create(auth,work,proposal);}
    @GetMapping("/api/expert/works/{work}/artifacts/{artifact}/preview")
    public ResponseEntity<byte[]> expert(Authentication auth,@PathVariable UUID work,@PathVariable UUID artifact){return image(artifacts.expertPreview(auth,work,artifact));}
    @GetMapping("/api/submissions/{submission}/artifacts/{artifact}/preview")
    public ResponseEntity<byte[]> owner(Authentication auth,@PathVariable UUID submission,@PathVariable UUID artifact){return image(artifacts.ownerPreview(actors.require(auth).getId(),submission,artifact));}
    private ResponseEntity<byte[]> image(MediaService.Content content){return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").body(content.bytes());}
}
