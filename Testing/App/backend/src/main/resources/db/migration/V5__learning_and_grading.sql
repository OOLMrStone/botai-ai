CREATE TABLE preparation_levels (id varchar(32) PRIMARY KEY, title text NOT NULL);
INSERT INTO preparation_levels VALUES ('zero','Начинаю с нуля'),('basics','Знаю базу'),('middle','Средний уровень'),('confident','Уверенно'),('strong','Сильный');
CREATE TABLE preparation_goals (id varchar(32) PRIMARY KEY, title text NOT NULL);
INSERT INTO preparation_goals VALUES ('norm','Норм'),('good','Хороший'),('good-plus','Джентльменский'),('excellent','Отличный'),('flawless','Безупречный');
CREATE TABLE plans (id varchar(32) PRIMARY KEY, title text NOT NULL);
INSERT INTO plans VALUES ('free','Бесплатный'),('pro','Pro');
ALTER TABLE users ADD COLUMN level_id varchar(32) REFERENCES preparation_levels(id),
    ADD COLUMN goal_id varchar(32) REFERENCES preparation_goals(id),
    ADD COLUMN plan_id varchar(32) NOT NULL DEFAULT 'free' REFERENCES plans(id),
    ADD COLUMN daily_goal_minutes integer NOT NULL DEFAULT 15 CHECK (daily_goal_minutes BETWEEN 1 AND 240),
    ADD COLUMN time_zone varchar(64) NOT NULL DEFAULT 'Europe/Moscow',
    ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN avatar_object_id uuid;
CREATE TABLE subjects (id varchar(32) PRIMARY KEY, title text NOT NULL);
INSERT INTO subjects VALUES ('profile-math','Профильная математика');
CREATE TABLE exam_formats (
    id varchar(64) PRIMARY KEY, version integer NOT NULL CHECK(version>0), subject_id varchar(32) NOT NULL REFERENCES subjects(id),
    title text NOT NULL, source_year integer NOT NULL, source_url text NOT NULL, source_status varchar(16) NOT NULL,
    total_tasks integer NOT NULL CHECK(total_tasks>0), max_points integer NOT NULL CHECK(max_points>0)
);
CREATE TABLE exam_positions (
    format_id varchar(64) NOT NULL REFERENCES exam_formats(id), exam_number integer NOT NULL,
    part integer NOT NULL CHECK(part IN(1,2)), title text NOT NULL, response_type varchar(8) NOT NULL CHECK(response_type IN('short','photo')),
    max_points integer NOT NULL CHECK(max_points>0), PRIMARY KEY(format_id,exam_number)
);
CREATE TABLE topics (
    id varchar(80) PRIMARY KEY, format_id varchar(64) NOT NULL, exam_number integer NOT NULL,
    title text NOT NULL, source_url text NOT NULL, sort_order integer NOT NULL,
    FOREIGN KEY(format_id,exam_number) REFERENCES exam_positions(format_id,exam_number)
);
CREATE TABLE tasks (id uuid PRIMARY KEY, current_version_id uuid, archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE task_versions (
    id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), version integer NOT NULL CHECK(version>0),
    format_id varchar(64) NOT NULL, exam_number integer NOT NULL, difficulty varchar(8) NOT NULL CHECK(difficulty IN('easy','medium','hard')),
    source_year integer NOT NULL, content jsonb NOT NULL CHECK(jsonb_typeof(content)='array'),
    statement text NOT NULL CHECK(length(statement) BETWEEN 1 AND 16000),
    reference_answer text NOT NULL CHECK(length(reference_answer) BETWEEN 1 AND 16000),
    reference_solution text CHECK(length(reference_solution) BETWEEN 1 AND 32000),
    is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(task_id,version), UNIQUE(task_id,id), FOREIGN KEY(format_id,exam_number) REFERENCES exam_positions(format_id,exam_number)
);
ALTER TABLE tasks ADD CONSTRAINT tasks_current_version_fk FOREIGN KEY(id,current_version_id) REFERENCES task_versions(task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE task_version_answers (task_version_id uuid NOT NULL REFERENCES task_versions(id), answer text NOT NULL, PRIMARY KEY(task_version_id,answer));
CREATE TABLE task_version_topics (task_version_id uuid NOT NULL REFERENCES task_versions(id), topic_id varchar(80) NOT NULL REFERENCES topics(id), PRIMARY KEY(task_version_id,topic_id));
CREATE INDEX task_version_topics_reverse_ix ON task_version_topics(topic_id,task_version_id);
CREATE INDEX task_versions_filter_ix ON task_versions(format_id,exam_number,difficulty,id);
CREATE TABLE exam_templates (id uuid PRIMARY KEY,title text NOT NULL,format_id varchar(64) NOT NULL REFERENCES exam_formats(id), version integer NOT NULL DEFAULT 1, published boolean NOT NULL DEFAULT false,is_demo boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE exam_template_items (template_id uuid NOT NULL REFERENCES exam_templates(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),task_version_id uuid NOT NULL REFERENCES task_versions(id),PRIMARY KEY(template_id,ordinal),UNIQUE(template_id,task_version_id));
CREATE TABLE attempts (
    id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),kind varchar(16) NOT NULL CHECK(kind IN('training','mock-exam')),
    template_id uuid REFERENCES exam_templates(id),format_id varchar(64) NOT NULL REFERENCES exam_formats(id),
    status varchar(16) NOT NULL DEFAULT 'active' CHECK(status IN('active','checking','completed')),revision integer NOT NULL DEFAULT 0,
    current_index integer NOT NULL DEFAULT 0 CHECK(current_index>=0),idempotency_key varchar(128) NOT NULL,request_hash varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
    UNIQUE(user_id,idempotency_key),UNIQUE(id,user_id)
);
CREATE INDEX attempts_owner_ix ON attempts(user_id,created_at DESC,id);
CREATE TABLE practice_selections (attempt_id uuid NOT NULL REFERENCES attempts(id),exam_number integer NOT NULL,count integer NOT NULL CHECK(count BETWEEN 1 AND 20),PRIMARY KEY(attempt_id,exam_number));
CREATE TABLE attempt_items (
    id uuid PRIMARY KEY,attempt_id uuid NOT NULL REFERENCES attempts(id),ordinal integer NOT NULL CHECK(ordinal>=0),
    task_version_id uuid NOT NULL REFERENCES task_versions(id),answer text NOT NULL DEFAULT '' CHECK(length(answer)<=2000),
    drawing jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(drawing)='array'),answer_revision integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(attempt_id,ordinal),UNIQUE(attempt_id,id)
);
CREATE TABLE user_favourites (user_id uuid NOT NULL REFERENCES users(id),task_id uuid NOT NULL REFERENCES tasks(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,task_id));
CREATE INDEX favourites_owner_ix ON user_favourites(user_id,created_at DESC,task_id);
CREATE TABLE grading_submissions (
    id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),attempt_id uuid REFERENCES attempts(id),attempt_item_id uuid,
    requested_attempt_id uuid NOT NULL,requested_item_id uuid NOT NULL,input_revision integer NOT NULL CHECK(input_revision>=0),revision integer NOT NULL DEFAULT 0,
    idempotency_key varchar(128) NOT NULL,request_hash varchar(64) NOT NULL,retry_of_id uuid REFERENCES grading_submissions(id),
    status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN('draft','queued','running','graded','rejected','failed','cancelled','expired','unsupported')),
    answer_snapshot text,task_version_id uuid REFERENCES task_versions(id),error_code varchar(80),is_demo boolean NOT NULL DEFAULT false,
    package_id varchar(80),provider_mode varchar(8),request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
    UNIQUE(user_id,idempotency_key),FOREIGN KEY(attempt_id,attempt_item_id) REFERENCES attempt_items(attempt_id,id),
    FOREIGN KEY(attempt_id,user_id) REFERENCES attempts(id,user_id)
);
CREATE UNIQUE INDEX submissions_active_item_ux ON grading_submissions(attempt_item_id) WHERE status IN('draft','queued','running');
CREATE INDEX submissions_owner_ix ON grading_submissions(user_id,created_at DESC,id);
CREATE INDEX submissions_item_ix ON grading_submissions(attempt_item_id,created_at DESC);
CREATE INDEX submissions_admin_ix ON grading_submissions(status,created_at DESC,id);
CREATE TABLE submission_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,submission_id uuid NOT NULL REFERENCES grading_submissions(id),event_type varchar(80) NOT NULL,actor_id uuid REFERENCES users(id),metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX submission_events_submission_ix ON submission_events(submission_id,id);
CREATE TABLE grading_results (
    submission_id uuid PRIMARY KEY REFERENCES grading_submissions(id),is_graded boolean NOT NULL,score integer,max_score integer NOT NULL CHECK(max_score>0),
    feedback jsonb,rejection_reason text,is_demo boolean NOT NULL,exact_response text,response_hash varchar(64),
    provider_mode varchar(8),package_id varchar(80),created_at timestamptz NOT NULL DEFAULT now(),
    CHECK((is_graded AND score IS NOT NULL AND score BETWEEN 0 AND max_score) OR (NOT is_graded AND score IS NULL))
);
CREATE TABLE grading_jobs (
    submission_id uuid PRIMARY KEY REFERENCES grading_submissions(id),state varchar(16) NOT NULL CHECK(state IN('ready','claimed','dispatching','done')),
    fencing_token bigint NOT NULL DEFAULT 0,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),run_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grading_jobs_ready_ix ON grading_jobs(available_at,submission_id) WHERE state='ready';
CREATE TABLE grading_runs (
    id uuid PRIMARY KEY,submission_id uuid NOT NULL UNIQUE REFERENCES grading_submissions(id),fencing_token bigint NOT NULL,
    package_id varchar(80) NOT NULL,provider_mode varchar(8),outcome varchar(80),created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
CREATE TABLE stored_objects (
    id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),submission_id uuid REFERENCES grading_submissions(id),
    purpose varchar(16) NOT NULL CHECK(purpose IN('solution','avatar')),bucket text NOT NULL,object_key text NOT NULL UNIQUE,
    state varchar(16) NOT NULL CHECK(state IN('staged','ready','delete_pending','deleted','failed')),
    file_name varchar(200) NOT NULL,mime_type varchar(64),size_bytes bigint,width integer,height integer,sha256 varchar(64),
    ordinal integer,created_at timestamptz NOT NULL DEFAULT now(),retention_until timestamptz,deleted_at timestamptz,
    UNIQUE(submission_id,ordinal)
);
CREATE INDEX stored_objects_owner_ix ON stored_objects(user_id,id);
CREATE INDEX stored_objects_submission_ix ON stored_objects(submission_id,state);
ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY(avatar_object_id) REFERENCES stored_objects(id);
CREATE TABLE user_task_results (user_id uuid NOT NULL REFERENCES users(id),task_id uuid NOT NULL REFERENCES tasks(id),submission_id uuid NOT NULL REFERENCES grading_submissions(id),first_solved_at timestamptz,last_solved_at timestamptz,PRIMARY KEY(user_id,task_id));
CREATE TABLE user_activity_days (user_id uuid NOT NULL REFERENCES users(id),local_date date NOT NULL,qualified boolean NOT NULL DEFAULT false,active_seconds integer NOT NULL DEFAULT 0 CHECK(active_seconds>=0),PRIMARY KEY(user_id,local_date));
CREATE TABLE activity_events (id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),attempt_id uuid NOT NULL REFERENCES attempts(id),seconds integer NOT NULL CHECK(seconds BETWEEN 0 AND 60),requested_seconds integer NOT NULL CHECK(requested_seconds BETWEEN 1 AND 60),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX activity_events_owner_time_ix ON activity_events(user_id,created_at DESC);
CREATE TABLE attempt_checks (user_id uuid NOT NULL REFERENCES users(id),idempotency_key varchar(128) NOT NULL,attempt_id uuid NOT NULL REFERENCES attempts(id),request_hash varchar(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,idempotency_key));
CREATE TABLE admin_access_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL REFERENCES users(id),action varchar(64) NOT NULL,target_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limit_windows (scope varchar(32) NOT NULL,subject_hash varchar(64) NOT NULL,window_start timestamptz NOT NULL,count integer NOT NULL CHECK(count>0),PRIMARY KEY(scope,subject_hash,window_start));
CREATE FUNCTION protect_immutable_content() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable content'; END $$;
CREATE TRIGGER immutable_task_version BEFORE UPDATE OR DELETE ON task_versions FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_task_answers BEFORE UPDATE OR DELETE ON task_version_answers FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_task_topics BEFORE UPDATE OR DELETE ON task_version_topics FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_results BEFORE UPDATE OR DELETE ON grading_results FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON submission_events FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE FUNCTION protect_attempt_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='DELETE' OR (NEW.attempt_id,NEW.ordinal,NEW.task_version_id) IS DISTINCT FROM (OLD.attempt_id,OLD.ordinal,OLD.task_version_id) THEN RAISE EXCEPTION 'immutable attempt membership'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_attempt_membership BEFORE UPDATE OR DELETE ON attempt_items FOR EACH ROW EXECUTE FUNCTION protect_attempt_membership();
CREATE FUNCTION validate_published_exam() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE tid uuid; expected_format varchar(64); BEGIN
    IF TG_TABLE_NAME='exam_templates' THEN tid := NEW.id; ELSE tid := COALESCE(NEW.template_id,OLD.template_id); END IF;
    SELECT format_id INTO expected_format FROM exam_templates WHERE id=tid AND published;
    IF expected_format IS NOT NULL AND (SELECT count(*)=20 AND count(DISTINCT v.exam_number)=20 AND bool_and(v.format_id=expected_format AND v.exam_number=i.ordinal) FROM exam_template_items i JOIN task_versions v ON v.id=i.task_version_id WHERE i.template_id=tid) IS NOT TRUE THEN RAISE EXCEPTION 'published exam requires exact 20 positions'; END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER exam_complete AFTER INSERT OR UPDATE ON exam_templates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_published_exam();
CREATE CONSTRAINT TRIGGER exam_items_complete AFTER INSERT OR UPDATE OR DELETE ON exam_template_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_published_exam();
CREATE FUNCTION protect_published_exam_items() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM exam_templates WHERE id=COALESCE(NEW.template_id,OLD.template_id) AND published) THEN RAISE EXCEPTION 'immutable published exam'; END IF; RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER immutable_exam_items BEFORE INSERT OR UPDATE OR DELETE ON exam_template_items FOR EACH ROW EXECUTE FUNCTION protect_published_exam_items();

CREATE TRIGGER immutable_exam_format BEFORE UPDATE OR DELETE ON exam_formats FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_exam_position BEFORE UPDATE OR DELETE ON exam_positions FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE FUNCTION protect_published_template() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.published THEN RAISE EXCEPTION 'immutable published template'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_published_template BEFORE UPDATE OR DELETE ON exam_templates FOR EACH ROW EXECUTE FUNCTION protect_published_template();
CREATE FUNCTION protect_published_task_children() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM tasks WHERE current_version_id=NEW.task_version_id) OR EXISTS(SELECT 1 FROM attempt_items WHERE task_version_id=NEW.task_version_id) THEN RAISE EXCEPTION 'immutable published task children'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_published_answers BEFORE INSERT ON task_version_answers FOR EACH ROW EXECUTE FUNCTION protect_published_task_children();
CREATE TRIGGER immutable_published_topics BEFORE INSERT ON task_version_topics FOR EACH ROW EXECUTE FUNCTION protect_published_task_children();
CREATE VIEW operator_users AS SELECT id,display_name,email,created_at FROM users;
