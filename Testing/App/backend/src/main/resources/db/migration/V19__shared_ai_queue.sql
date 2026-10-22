-- Queued expert grading has no model deadline until shared admission grants a slot.
ALTER TABLE expert_grading_jobs DROP CONSTRAINT expert_grading_jobs_state_check;
ALTER TABLE expert_grading_jobs ADD CONSTRAINT expert_grading_jobs_state_check
    CHECK (state IN ('queued','pending','succeeded','failed','unknown','stale'));
ALTER TABLE expert_grading_jobs ALTER COLUMN deadline_at DROP NOT NULL;
ALTER TABLE expert_grading_jobs ADD CONSTRAINT expert_grading_deadline_check
    CHECK ((state='queued' AND deadline_at IS NULL) OR state IN ('stale','failed') OR deadline_at IS NOT NULL);
DROP INDEX expert_grading_inflight_ux;
CREATE UNIQUE INDEX expert_grading_inflight_ux ON expert_grading_jobs(work_id)
    WHERE state IN ('queued','pending','unknown');
CREATE INDEX expert_grading_queue_idx ON expert_grading_jobs(created_at,id) WHERE state='queued';
CREATE OR REPLACE FUNCTION protect_expert_grading_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='DELETE' OR (NEW.id,NEW.work_id,NEW.school_id,NEW.expert_user_id,NEW.idempotency_key,NEW.request_hash,NEW.input_hash,NEW.base_revision,NEW.prepared_revision,NEW.document,NEW.created_at)
        IS DISTINCT FROM (OLD.id,OLD.work_id,OLD.school_id,OLD.expert_user_id,OLD.idempotency_key,OLD.request_hash,OLD.input_hash,OLD.base_revision,OLD.prepared_revision,OLD.document,OLD.created_at)
        THEN RAISE EXCEPTION 'immutable grading reservation'; END IF;
    IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at AND NOT
        (OLD.state='queued' AND OLD.deadline_at IS NULL AND NEW.state='pending' AND NEW.deadline_at IS NOT NULL)
        THEN RAISE EXCEPTION 'immutable grading deadline'; END IF;
    IF OLD.state NOT IN ('queued','pending','unknown') THEN RAISE EXCEPTION 'terminal grading job'; END IF;
    IF OLD.state='unknown' AND NEW.state<>'stale' THEN RAISE EXCEPTION 'unknown grading job requires explicit reconciliation'; END IF;
    IF OLD.state='queued' AND NEW.state NOT IN ('queued','pending','stale','failed') THEN RAISE EXCEPTION 'invalid queued transition'; END IF;
    IF OLD.state='pending' AND NEW.state='queued' THEN RAISE EXCEPTION 'dispatched grading must not be replayed'; END IF;
    RETURN NEW;
END $$;

-- IDs are either full-photo run UUIDs or expert-grade job UUIDs; originals remain immutable.
CREATE TABLE local_ai_acknowledgements (run_id uuid PRIMARY KEY,acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp());

ALTER TABLE expert_grading_jobs ADD COLUMN failure jsonb CHECK (failure IS NULL OR jsonb_typeof(failure)='object');
