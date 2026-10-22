-- Image-based school fixtures keep each validated preparation with its own submission.
-- Shared assignments and earlier results remain immutable across repeated checks.
CREATE TABLE school_submission_task_preparations (
 submission_id uuid PRIMARY KEY REFERENCES grading_submissions(id),
 statement text NOT NULL CHECK(length(statement) BETWEEN 1 AND 16000),
 reference_answer text NOT NULL CHECK(length(reference_answer) BETWEEN 1 AND 16000),
 reference_solution text CHECK(length(reference_solution)<=32000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION require_school_image_preparation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM grading_submissions s JOIN school_assignments a ON a.id=s.school_assignment_id
 JOIN school_tasks t ON t.id=a.task_id WHERE s.id=NEW.submission_id AND s.origin='school' AND t.input_mode='from-images')
 THEN RAISE EXCEPTION 'school image preparation requires an image-based school submission'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER school_image_preparation_scope BEFORE INSERT ON school_submission_task_preparations
 FOR EACH ROW EXECUTE FUNCTION require_school_image_preparation();
CREATE TRIGGER immutable_school_preparation BEFORE UPDATE OR DELETE ON school_submission_task_preparations
 FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE OR REPLACE VIEW grading_task_snapshots AS
 SELECT s.id submission_id,v.id,v.task_id,v.exam_number,p.max_points max_score,v.statement,v.content,v.reference_answer,v.reference_solution,v.is_demo
 FROM grading_submissions s JOIN task_versions v ON v.id=s.task_version_id JOIN exam_positions p ON p.format_id=v.format_id AND p.exam_number=v.exam_number WHERE s.origin='b2c'
 UNION ALL SELECT s.id,t.id,t.id,t.task_number,t.max_score,coalesce(prep.statement,t.statement),t.content,
 coalesce(prep.reference_answer,t.reference_answer),CASE WHEN prep.submission_id IS NOT NULL THEN prep.reference_solution ELSE t.reference_solution END,t.is_demo
 FROM grading_submissions s JOIN school_assignments a ON a.id=s.school_assignment_id JOIN school_tasks t ON t.id=a.task_id
 LEFT JOIN school_submission_task_preparations prep ON prep.submission_id=s.id WHERE s.origin='school'
 UNION ALL SELECT s.id,t.id,t.id,t.task_number,t.max_score,t.statement,t.content,t.reference_answer,t.reference_solution,t.is_demo
 FROM grading_submissions s JOIN b2b_manual_tasks t ON t.id=s.manual_task_id WHERE s.origin='local_demo';
