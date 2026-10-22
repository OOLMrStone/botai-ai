-- Preserve legacy snapshots verbatim. New numeric ratings are explicit, never inferred
-- from the former easy/medium/hard labels (medium also represented unknown imports).
ALTER TABLE task_versions ALTER COLUMN difficulty DROP NOT NULL;
ALTER TABLE task_versions ADD COLUMN difficulty_level smallint
    CHECK (difficulty_level BETWEEN 1 AND 5);
ALTER TABLE task_versions ADD COLUMN is_grob boolean
    GENERATED ALWAYS AS (coalesce(difficulty_level = 5, false)) STORED;
CREATE INDEX task_versions_difficulty_level_ix ON task_versions(format_id,exam_number,difficulty_level,id);
COMMENT ON COLUMN task_versions.difficulty IS 'Legacy immutable label; retained for old-package replay, not mapped to numeric ratings';
COMMENT ON COLUMN task_versions.difficulty_level IS 'Explicit 1..5 rating; NULL means unknown';
