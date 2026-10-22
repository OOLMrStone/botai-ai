CREATE TABLE school_tasks (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),task_number integer NOT NULL CHECK(task_number IN(14,16,17,18)),
 max_score integer NOT NULL CHECK(max_score BETWEEN 1 AND 4),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 500),
 statement text NOT NULL CHECK(length(statement) BETWEEN 1 AND 16000),content jsonb NOT NULL CHECK(jsonb_typeof(content)='array'),
 reference_answer text NOT NULL CHECK(length(reference_answer) BETWEEN 1 AND 16000),reference_solution text CHECK(length(reference_solution)<=32000),
 is_demo boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,school_id)
);
CREATE TRIGGER immutable_school_task BEFORE UPDATE OR DELETE ON school_tasks FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TABLE school_assignments (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,student_user_id uuid NOT NULL,task_id uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 500),
 assigned_at timestamptz NOT NULL DEFAULT now(),due_at timestamptz,enabled boolean NOT NULL DEFAULT true,closed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,student_user_id) REFERENCES school_students(school_id,user_id),FOREIGN KEY(task_id,school_id) REFERENCES school_tasks(id,school_id),
 UNIQUE(id,school_id,student_user_id),UNIQUE(id,student_user_id)
);
CREATE INDEX school_assignments_student_ix ON school_assignments(student_user_id,assigned_at DESC,id);
CREATE FUNCTION protect_school_assignment_target() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.school_id,NEW.student_user_id,NEW.task_id,NEW.title,NEW.assigned_at,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.student_user_id,OLD.task_id,OLD.title,OLD.assigned_at,OLD.created_at) THEN RAISE EXCEPTION 'immutable school assignment target'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_school_assignment BEFORE UPDATE OR DELETE ON school_assignments FOR EACH ROW EXECUTE FUNCTION protect_school_assignment_target();
CREATE TABLE school_task_assets (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,task_id uuid NOT NULL,kind varchar(16) NOT NULL CHECK(kind IN('statement','reference')),
 bucket text NOT NULL,object_key text NOT NULL UNIQUE,file_name text NOT NULL,mime_type varchar(64) NOT NULL CHECK(mime_type='image/jpeg'),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),sha256 varchar(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,school_id) REFERENCES school_tasks(id,school_id)
);
CREATE TRIGGER immutable_school_task_asset BEFORE UPDATE OR DELETE ON school_task_assets FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TABLE b2b_manual_tasks (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),task_number integer NOT NULL CHECK(task_number IN(14,16,17,18)),
 max_score integer NOT NULL CHECK(max_score BETWEEN 1 AND 4),statement text,reference_answer text,reference_solution text,content jsonb NOT NULL DEFAULT '[]'::jsonb,
 bucket text NOT NULL,object_key text NOT NULL UNIQUE,file_name text NOT NULL,mime_type varchar(64) NOT NULL CHECK(mime_type='image/jpeg'),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),sha256 varchar(64) NOT NULL,is_demo boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,user_id)
);
CREATE FUNCTION protect_manual_task_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.user_id,NEW.task_number,NEW.max_score,NEW.bucket,NEW.object_key,NEW.file_name,NEW.mime_type,NEW.size_bytes,NEW.sha256,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.task_number,OLD.max_score,OLD.bucket,OLD.object_key,OLD.file_name,OLD.mime_type,OLD.size_bytes,OLD.sha256,OLD.created_at)
 OR (OLD.statement IS NOT NULL AND (NEW.statement,NEW.reference_answer,NEW.reference_solution,NEW.content,NEW.is_demo) IS DISTINCT FROM (OLD.statement,OLD.reference_answer,OLD.reference_solution,OLD.content,OLD.is_demo))
 THEN RAISE EXCEPTION 'immutable manual task snapshot'; END IF;
 IF NEW.statement IS NOT NULL AND (length(NEW.statement) NOT BETWEEN 1 AND 16000 OR NEW.reference_answer IS NULL OR length(NEW.reference_answer) NOT BETWEEN 1 AND 16000 OR jsonb_typeof(NEW.content)<>'array') THEN RAISE EXCEPTION 'invalid manual task snapshot'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_manual_task_snapshot BEFORE UPDATE OR DELETE ON b2b_manual_tasks FOR EACH ROW EXECUTE FUNCTION protect_manual_task_snapshot();
ALTER TABLE grading_submissions ADD COLUMN origin varchar(16) NOT NULL DEFAULT 'b2c' CHECK(origin IN('b2c','school','local_demo')),
 ADD COLUMN school_assignment_id uuid,ADD COLUMN manual_task_id uuid,
 ALTER COLUMN requested_attempt_id DROP NOT NULL,ALTER COLUMN requested_item_id DROP NOT NULL,
 ADD CONSTRAINT submission_school_owner_fk FOREIGN KEY(school_assignment_id,user_id) REFERENCES school_assignments(id,student_user_id),
 ADD CONSTRAINT submission_manual_owner_fk FOREIGN KEY(manual_task_id,user_id) REFERENCES b2b_manual_tasks(id,user_id),
 ADD CONSTRAINT submission_origin_target_ck CHECK(
  (origin='b2c' AND requested_attempt_id IS NOT NULL AND requested_item_id IS NOT NULL AND school_assignment_id IS NULL AND manual_task_id IS NULL)
  OR (origin='school' AND school_assignment_id IS NOT NULL AND manual_task_id IS NULL AND attempt_id IS NULL AND attempt_item_id IS NULL AND requested_attempt_id IS NULL AND requested_item_id IS NULL AND task_version_id IS NULL)
  OR (origin='local_demo' AND manual_task_id IS NOT NULL AND school_assignment_id IS NULL AND attempt_id IS NULL AND attempt_item_id IS NULL AND requested_attempt_id IS NULL AND requested_item_id IS NULL AND task_version_id IS NULL));
CREATE UNIQUE INDEX school_submission_active_ux ON grading_submissions(school_assignment_id) WHERE origin='school' AND status NOT IN('failed','cancelled','expired');
CREATE FUNCTION protect_submission_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.origin,NEW.school_assignment_id,NEW.manual_task_id) IS DISTINCT FROM (OLD.origin,OLD.school_assignment_id,OLD.manual_task_id) THEN RAISE EXCEPTION 'immutable submission origin'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_submission_origin BEFORE UPDATE ON grading_submissions FOR EACH ROW EXECUTE FUNCTION protect_submission_origin();
CREATE VIEW grading_task_snapshots AS
 SELECT s.id submission_id,v.id,v.task_id,v.exam_number,p.max_points max_score,v.statement,v.content,v.reference_answer,v.reference_solution,v.is_demo
 FROM grading_submissions s JOIN task_versions v ON v.id=s.task_version_id JOIN exam_positions p ON p.format_id=v.format_id AND p.exam_number=v.exam_number WHERE s.origin='b2c'
 UNION ALL SELECT s.id,t.id,t.id,t.task_number,t.max_score,t.statement,t.content,t.reference_answer,t.reference_solution,t.is_demo
 FROM grading_submissions s JOIN school_assignments a ON a.id=s.school_assignment_id JOIN school_tasks t ON t.id=a.task_id WHERE s.origin='school'
 UNION ALL SELECT s.id,t.id,t.id,t.task_number,t.max_score,t.statement,t.content,t.reference_answer,t.reference_solution,t.is_demo
 FROM grading_submissions s JOIN b2b_manual_tasks t ON t.id=s.manual_task_id WHERE s.origin='local_demo';
CREATE TABLE expert_notifications (
 id uuid PRIMARY KEY,seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,work_id uuid NOT NULL REFERENCES expert_works(id),
 school_id uuid NOT NULL,expert_user_id uuid NOT NULL,type varchar(32) NOT NULL CHECK(type='work_queued'),created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,
 FOREIGN KEY(school_id,expert_user_id) REFERENCES school_experts(school_id,user_id),UNIQUE(work_id,type)
);
CREATE INDEX expert_notifications_actor_seq_ix ON expert_notifications(expert_user_id,seq);
CREATE TABLE local_demo_runs (
 id uuid PRIMARY KEY,submission_id uuid NOT NULL UNIQUE REFERENCES grading_submissions(id),actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stored_objects ADD CONSTRAINT stored_objects_id_submission_ux UNIQUE(id,submission_id);
CREATE TABLE submission_artifacts (
 id uuid PRIMARY KEY,submission_id uuid NOT NULL REFERENCES grading_submissions(id),source_image_id uuid NOT NULL,
 kind varchar(32) NOT NULL CHECK(kind='student_crop'),bbox jsonb NOT NULL CHECK(jsonb_typeof(bbox)='object'),
 state varchar(16) NOT NULL CHECK(state IN('staged','ready','delete_pending','deleted','failed')),
 bucket text NOT NULL,object_key text NOT NULL UNIQUE,file_name text NOT NULL,mime_type varchar(64) NOT NULL DEFAULT 'image/jpeg' CHECK(mime_type='image/jpeg'),
 size_bytes bigint,width integer,height integer,sha256 varchar(64),alt text NOT NULL DEFAULT '' CHECK(length(alt)<=200),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_image_id,submission_id) REFERENCES stored_objects(id,submission_id)
);
CREATE FUNCTION protect_submission_artifact_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.submission_id,NEW.source_image_id,NEW.kind,NEW.bbox,NEW.bucket,NEW.object_key,NEW.alt,NEW.file_name,NEW.mime_type,NEW.size_bytes,NEW.width,NEW.height,NEW.sha256,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.submission_id,OLD.source_image_id,OLD.kind,OLD.bbox,OLD.bucket,OLD.object_key,OLD.alt,OLD.file_name,OLD.mime_type,OLD.size_bytes,OLD.width,OLD.height,OLD.sha256,OLD.created_at) THEN RAISE EXCEPTION 'immutable crop origin'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_submission_artifact BEFORE UPDATE OR DELETE ON submission_artifacts FOR EACH ROW EXECUTE FUNCTION protect_submission_artifact_origin();
-- Correlate actual AI observer facts with the existing append-only public event sequence.
CREATE TABLE local_demo_observer_events (
 ai_run_id uuid NOT NULL REFERENCES grading_runs(id),ai_seq bigint NOT NULL CHECK(ai_seq>0),
 event_id bigint NOT NULL UNIQUE REFERENCES submission_events(id),PRIMARY KEY(ai_run_id,ai_seq)
);
CREATE TRIGGER immutable_local_demo_observer_events BEFORE UPDATE OR DELETE ON local_demo_observer_events FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
-- Publication order is serialized independently of submission completion. A source event
-- that commits late is still projected with a later public sequence, never skipped by a cursor.
CREATE TABLE local_demo_public_events (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,run_id uuid NOT NULL REFERENCES local_demo_runs(id),
 source_event_id bigint NOT NULL UNIQUE REFERENCES submission_events(id),
 type varchar(80) NOT NULL,phase varchar(80) NOT NULL,state varchar(32) NOT NULL,
 created_at timestamptz NOT NULL,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
CREATE INDEX local_demo_public_events_run_seq_ix ON local_demo_public_events(run_id,seq);
CREATE TRIGGER immutable_local_demo_public_events BEFORE UPDATE OR DELETE ON local_demo_public_events FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
-- Durable observer-only reconciliation never replays grading POSTs.
CREATE TABLE local_demo_observer_jobs (
 ai_run_id uuid PRIMARY KEY REFERENCES grading_runs(id),submission_id uuid NOT NULL REFERENCES grading_submissions(id),
 fencing_token bigint NOT NULL,next_poll_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '25 minutes',
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),completed_at timestamptz,
 incomplete_reason varchar(32) CHECK(incomplete_reason IN('scope_revoked','observer_expired')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_local_demo_observer_job_target() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.ai_run_id,NEW.submission_id,NEW.fencing_token,NEW.expires_at,NEW.created_at) IS DISTINCT FROM (OLD.ai_run_id,OLD.submission_id,OLD.fencing_token,OLD.expires_at,OLD.created_at) THEN RAISE EXCEPTION 'immutable observer target'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_local_demo_observer_job_target BEFORE UPDATE ON local_demo_observer_jobs FOR EACH ROW EXECUTE FUNCTION protect_local_demo_observer_job_target();
