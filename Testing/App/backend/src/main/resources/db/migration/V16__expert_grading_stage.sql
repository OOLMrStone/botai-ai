ALTER TABLE expert_works ADD COLUMN graded_input_hash varchar(64),
    ADD COLUMN accepted_grading jsonb CHECK (jsonb_typeof(accepted_grading)='object');
CREATE TABLE expert_grading_jobs (
    id uuid PRIMARY KEY,
    work_id uuid NOT NULL REFERENCES expert_works(id),
    school_id uuid NOT NULL REFERENCES schools(id),
    expert_user_id uuid NOT NULL REFERENCES users(id),
    idempotency_key varchar(128) NOT NULL,
    request_hash varchar(64) NOT NULL,
    input_hash varchar(64) NOT NULL,
    base_revision integer NOT NULL,
    prepared_revision integer NOT NULL,
    applied_revision integer,
    document jsonb NOT NULL,
    state varchar(12) NOT NULL CHECK (state IN ('pending','succeeded','failed','unknown','stale')),
    grading jsonb CHECK (jsonb_typeof(grading)='object'),
    error_code varchar(80),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deadline_at timestamptz NOT NULL DEFAULT now()+interval '7 minutes',
    UNIQUE (work_id, expert_user_id, idempotency_key),
    CHECK (prepared_revision=base_revision+1),
    CHECK ((state='succeeded' AND grading IS NOT NULL AND applied_revision=prepared_revision+1)
        OR (state<>'succeeded' AND applied_revision IS NULL))
);
CREATE UNIQUE INDEX expert_grading_inflight_ux ON expert_grading_jobs(work_id) WHERE state IN ('pending','unknown');
CREATE FUNCTION protect_expert_grading_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='DELETE' OR (NEW.id,NEW.work_id,NEW.school_id,NEW.expert_user_id,NEW.idempotency_key,NEW.request_hash,NEW.input_hash,NEW.base_revision,NEW.prepared_revision,NEW.document,NEW.created_at,NEW.deadline_at)
        IS DISTINCT FROM (OLD.id,OLD.work_id,OLD.school_id,OLD.expert_user_id,OLD.idempotency_key,OLD.request_hash,OLD.input_hash,OLD.base_revision,OLD.prepared_revision,OLD.document,OLD.created_at,OLD.deadline_at)
        THEN RAISE EXCEPTION 'immutable grading reservation'; END IF;
    IF OLD.state NOT IN ('pending','unknown') THEN RAISE EXCEPTION 'terminal grading job'; END IF;
    IF OLD.state='unknown' AND NEW.state<>'stale' THEN RAISE EXCEPTION 'unknown grading job requires explicit reconciliation'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_expert_grading_job BEFORE UPDATE OR DELETE ON expert_grading_jobs
    FOR EACH ROW EXECUTE FUNCTION protect_expert_grading_job();
