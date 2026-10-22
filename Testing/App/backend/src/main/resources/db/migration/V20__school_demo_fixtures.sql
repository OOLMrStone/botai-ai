-- Additive expansion: immutable historical tasks, submissions and results stay intact.
ALTER TABLE school_tasks DROP CONSTRAINT school_tasks_task_number_check;
ALTER TABLE school_tasks ADD CONSTRAINT school_tasks_task_number_check CHECK(task_number BETWEEN 14 AND 20);
ALTER TABLE b2b_manual_tasks DROP CONSTRAINT b2b_manual_tasks_task_number_check;
ALTER TABLE b2b_manual_tasks ADD CONSTRAINT b2b_manual_tasks_task_number_check CHECK(task_number BETWEEN 14 AND 20);
CREATE TABLE school_solution_fixtures (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES school_tasks(id), ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 3), UNIQUE(task_id,ordinal),
 object_key text NOT NULL UNIQUE, size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),
 sha256 varchar(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_school_solution_fixture BEFORE UPDATE OR DELETE ON school_solution_fixtures FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TABLE school_fixture_attachments (
 submission_id uuid PRIMARY KEY REFERENCES grading_submissions(id),
 complete boolean NOT NULL DEFAULT false
);

ALTER TABLE school_tasks ADD COLUMN input_mode varchar(16) NOT NULL DEFAULT 'prepared' CHECK(input_mode IN('prepared','from-images'));
DROP INDEX school_submission_active_ux;
CREATE UNIQUE INDEX school_submission_active_ux ON grading_submissions(school_assignment_id) WHERE origin='school' AND (status IN('draft','queued','running') OR error_code='unknown_after_dispatch');

ALTER TABLE school_tasks ALTER COLUMN reference_answer DROP NOT NULL;
ALTER TABLE school_tasks ADD CONSTRAINT school_tasks_prepared_answer_check CHECK(input_mode='from-images' OR reference_answer IS NOT NULL);
