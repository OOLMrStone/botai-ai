package org.botai.back.profile;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.botai.back.security.CurrentActor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import static org.botai.back.profile.ActivityTimerDtos.*;

@RestController
@RequestMapping("/api/activity-timer")
@RequiredArgsConstructor
public class ActivityTimerController {
    private final ActivityTimerService timers;
    private final CurrentActor actors;
    @GetMapping public ResponseEntity<TimerState> get(Authentication auth) {
        return response(timers.get(actors.require(auth).getId()));
    }
    @PostMapping("/start") public ResponseEntity<TimerState> start(Authentication auth, @Valid @RequestBody Start request) {
        return response(timers.start(actors.require(auth).getId(), request));
    }
    @PostMapping("/heartbeat") public ResponseEntity<TimerState> heartbeat(Authentication auth, @Valid @RequestBody Tick request) {
        return response(timers.heartbeat(actors.require(auth).getId(), request));
    }
    @PostMapping("/pause") public ResponseEntity<TimerState> pause(Authentication auth, @Valid @RequestBody Tick request) {
        return response(timers.pause(actors.require(auth).getId(), request));
    }
    private ResponseEntity<TimerState> response(TimerState state) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(state);
    }
}
