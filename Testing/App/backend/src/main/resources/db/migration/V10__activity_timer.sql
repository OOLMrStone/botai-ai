-- The state row is also a permanent adoption marker for the legacy endpoint.
-- Attempt identifiers deliberately have no FK: deleting an attempt retains time history.
CREATE TABLE activity_timer_state (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    session_id uuid NOT NULL,
    client_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    active boolean NOT NULL,
    acknowledged_at timestamptz NOT NULL
);
CREATE TABLE activity_timer_events (
    event_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    attempt_id uuid NOT NULL,
    request_hash varchar(64) NOT NULL,
    accepted_nanos bigint NOT NULL CHECK (accepted_nanos BETWEEN 0 AND 45000000000),
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX activity_timer_events_attempt_ix ON activity_timer_events(user_id,attempt_id);
ALTER TABLE user_activity_days ADD COLUMN timer_remainder_nanos integer NOT NULL DEFAULT 0
    CHECK (timer_remainder_nanos BETWEEN 0 AND 999999999);
