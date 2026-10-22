ALTER TABLE attempts ADD COLUMN last_exited_at timestamptz;

CREATE TABLE attempt_exit_events (
    event_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES attempts(id),
    exited_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX attempts_visible_recent_exit_idx
    ON attempts(user_id, coalesce(last_exited_at, created_at) DESC, id DESC)
    WHERE deleted_at IS NULL;
