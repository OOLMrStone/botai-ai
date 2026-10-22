CREATE TABLE schools (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE school_experts (
    school_id uuid NOT NULL REFERENCES schools(id),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id),
    enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (school_id, user_id)
);
-- Принадлежность подтверждается оператором школы; публичной саморегистрации в roster нет.
CREATE TABLE school_students (
    school_id uuid NOT NULL REFERENCES schools(id),
    user_id uuid NOT NULL REFERENCES users(id),
    first_name text NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
    last_name text NOT NULL CHECK (length(last_name) BETWEEN 1 AND 100),
    contact text CHECK (length(contact) <= 500),
    enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (school_id, user_id)
);
CREATE TABLE expert_students (
    school_id uuid NOT NULL,
    student_user_id uuid NOT NULL,
    expert_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (school_id, student_user_id),
    FOREIGN KEY (school_id, student_user_id) REFERENCES school_students(school_id, user_id),
    FOREIGN KEY (school_id, expert_user_id) REFERENCES school_experts(school_id, user_id)
);
ALTER TABLE grading_submissions ADD CONSTRAINT submissions_id_user_ux UNIQUE (id, user_id);
CREATE TABLE expert_works (
    id uuid PRIMARY KEY,
    school_id uuid NOT NULL,
    student_user_id uuid NOT NULL,
    expert_user_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    status varchar(8) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','draft','sent')),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    ai_document jsonb NOT NULL CHECK (jsonb_typeof(ai_document) = 'object'),
    document jsonb CHECK (jsonb_typeof(document) = 'object'),
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (school_id, submission_id),
    FOREIGN KEY (school_id, student_user_id) REFERENCES school_students(school_id, user_id),
    FOREIGN KEY (school_id, expert_user_id) REFERENCES school_experts(school_id, user_id),
    FOREIGN KEY (submission_id, student_user_id) REFERENCES grading_submissions(id, user_id),
    CHECK ((status = 'queued' AND document IS NULL AND revision = 0 AND sent_at IS NULL)
        OR (status = 'draft' AND document IS NOT NULL AND revision > 0 AND sent_at IS NULL)
        OR (status = 'sent' AND document IS NOT NULL AND revision > 0 AND sent_at IS NOT NULL))
);
CREATE INDEX expert_works_queue_ix ON expert_works(school_id, expert_user_id, created_at DESC, id);
CREATE TABLE expert_review_versions (
    work_id uuid NOT NULL REFERENCES expert_works(id),
    revision integer NOT NULL CHECK (revision > 0),
    kind varchar(8) NOT NULL CHECK (kind IN ('draft','final')),
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    actor_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_id, revision)
);
CREATE UNIQUE INDEX expert_review_one_final_ux ON expert_review_versions(work_id) WHERE kind = 'final';
CREATE TRIGGER immutable_expert_versions BEFORE UPDATE OR DELETE ON expert_review_versions
    FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE FUNCTION protect_expert_work() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP = 'DELETE' OR OLD.status = 'sent' THEN RAISE EXCEPTION 'immutable expert review'; END IF;
    IF (NEW.id, NEW.school_id, NEW.student_user_id, NEW.expert_user_id, NEW.submission_id, NEW.ai_document, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.school_id, OLD.student_user_id, OLD.expert_user_id, OLD.submission_id, OLD.ai_document, OLD.created_at)
        THEN RAISE EXCEPTION 'immutable expert review origin'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_expert_work BEFORE UPDATE OR DELETE ON expert_works
    FOR EACH ROW EXECUTE FUNCTION protect_expert_work();
