package org.botai.back.profile;

import org.springframework.stereotype.Component;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** Separate server clock boundary so protocol tests never need to sleep. */
@Component
public class ActivityTimerClock {
    public Instant now() { return Instant.now().truncatedTo(ChronoUnit.MICROS); }
}
