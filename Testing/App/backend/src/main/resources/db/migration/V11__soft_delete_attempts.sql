ALTER TABLE attempts ADD COLUMN deleted_at timestamptz;

CREATE INDEX attempts_visible_user_created_idx
    ON attempts(user_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
