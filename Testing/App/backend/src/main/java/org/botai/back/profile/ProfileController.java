package org.botai.back.profile;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.botai.back.security.CurrentActor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import static org.botai.back.profile.ProfileDtos.*;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ProfileController {
    private final ProfileService service;
    private final CurrentActor actors;
    @GetMapping("/profile") public Profile get(Authentication auth) { return service.get(actors.require(auth).getId()); }
    @PatchMapping({"/profile","/onboarding"}) public Profile patch(Authentication auth,@Valid @RequestBody Patch patch) { return service.patch(actors.require(auth).getId(),patch); }
    @GetMapping("/stats") public Stats stats(Authentication auth) { return service.stats(actors.require(auth).getId()); }
    @PostMapping("/activity-events") public Stats activity(Authentication auth,@Valid @RequestBody Activity event) { return service.activity(actors.require(auth).getId(),event); }
}
