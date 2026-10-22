package org.botai.back.catalog;

import lombok.RequiredArgsConstructor;
import org.botai.back.attempt.AttemptService;
import org.botai.back.media.MediaService;
import org.botai.back.security.CurrentActor;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class CatalogMediaController {
    private final CurrentActor actors;
    private final CatalogMediaService media;
    private final CatalogService catalog;
    private final AttemptService attempts;

    @GetMapping("/api/catalog-media/{id}") public ResponseEntity<byte[]> statement(Authentication auth,@PathVariable UUID id) {
        return response(media.statement(actors.require(auth).getId(),id));
    }
    @GetMapping("/api/attempts/{attempt}/items/{item}/solution-media/{id}") public ResponseEntity<byte[]> reference(Authentication auth,@PathVariable UUID attempt,@PathVariable UUID item,@PathVariable UUID id) {
        return response(media.reference(attempts.solutionVersion(actors.require(auth).getId(),attempt,item),id));
    }
    @GetMapping("/api/daily-task/solution-media/{id}") public ResponseEntity<byte[]> daily(Authentication auth,@PathVariable UUID id) {
        return response(media.reference(catalog.daily(actors.require(auth).getId()).taskVersionId(),id));
    }
    @GetMapping("/api/admin/catalog-media/{id}") public ResponseEntity<byte[]> admin(Authentication auth,@PathVariable UUID id) {
        return response(media.admin(actors.requireAdmin(auth).getId(),id));
    }
    private ResponseEntity<byte[]> response(MediaService.Content content) {
        return ResponseEntity.ok().header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(content.mimeType())).body(content.bytes());
    }
}
