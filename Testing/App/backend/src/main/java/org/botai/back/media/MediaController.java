package org.botai.back.media;
import lombok.RequiredArgsConstructor;
import org.botai.back.security.CurrentActor;
import org.botai.back.user.Role;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class MediaController {
    private final CurrentActor actors;private final MediaService service;
    @GetMapping("/api/media/{id}") public ResponseEntity<byte[]> read(Authentication a,@PathVariable UUID id){var actor=actors.require(a);boolean admin=actor.getRole()==Role.ADMIN;if(admin)actors.requireAdmin(a);var content=service.read(actor.getId(),admin,id);return ResponseEntity.ok().header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(content.mimeType())).body(content.bytes());}
    @PostMapping("/api/profile/avatar") public Object avatar(Authentication a,@RequestParam MultipartFile file){return service.avatar(actors.require(a).getId(),file);}
    @DeleteMapping("/api/profile/avatar") public Object remove(Authentication a){return service.removeAvatar(actors.require(a).getId());}
}
