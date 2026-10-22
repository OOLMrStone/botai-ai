-- Additive: V13 payment snapshots, payloads and grants retain their original meaning.
CREATE TABLE billing_test_subscriptions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    shop_id varchar(32) NOT NULL,
    consent_version varchar(64) NOT NULL,
    consent_text text NOT NULL,
    consent_hash char(64) NOT NULL,
    consent_accepted_at timestamptz NOT NULL,
    status varchar(32) NOT NULL CHECK(status IN('pending_initial','active','payment_failed','canceled','review_required')),
    renewal_enabled boolean NOT NULL DEFAULT false,
    revoked_at timestamptz,
    revision integer NOT NULL DEFAULT 0,
    payment_method_id varchar(64),
    next_due_at timestamptz,
    action_required varchar(64),
    qa_early_used boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK(NOT renewal_enabled OR (revoked_at IS NULL AND payment_method_id IS NOT NULL AND next_due_at IS NOT NULL))
);
ALTER TABLE billing_test_payments ADD COLUMN subscription_id uuid REFERENCES billing_test_subscriptions(id),
    ADD COLUMN purpose varchar(32) NOT NULL DEFAULT 'one_time' CHECK(purpose IN('one_time','subscription_initial','subscription_renewal')),
    ADD COLUMN post_authorized_at timestamptz,
    ADD COLUMN authorized_revision integer,
    ADD COLUMN post_attempts integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT billing_payment_purpose CHECK((purpose='one_time')=(subscription_id IS NULL));
CREATE TABLE billing_test_subscription_periods (
    subscription_id uuid NOT NULL REFERENCES billing_test_subscriptions(id),
    sequence integer NOT NULL CHECK(sequence>0),
    payment_id uuid NOT NULL UNIQUE REFERENCES billing_test_payments(id),
    PRIMARY KEY(subscription_id,sequence)
);
CREATE INDEX billing_test_sub_user_idx ON billing_test_subscriptions(user_id,created_at);
CREATE INDEX billing_test_sub_due_idx ON billing_test_subscriptions(next_due_at) WHERE renewal_enabled;
CREATE TABLE billing_test_usage_settlements (
    submission_id uuid PRIMARY KEY REFERENCES billing_test_usage(submission_id),
    outcome varchar(8) NOT NULL CHECK(outcome IN('consume','release')),
    reason varchar(64) NOT NULL,
    settled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_billing_settlement BEFORE UPDATE OR DELETE ON billing_test_usage_settlements FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
-- Only proven results are consumed; uncertain dispatches remain reserved for the runtime finalizer.
INSERT INTO billing_test_usage_settlements(submission_id,outcome,reason)
SELECT u.submission_id,'consume','v13_graded' FROM billing_test_usage u
JOIN grading_submissions s ON s.id=u.submission_id JOIN grading_results r ON r.submission_id=s.id
WHERE s.status='graded' AND r.is_graded;
INSERT INTO billing_test_usage_settlements(submission_id,outcome,reason)
SELECT u.submission_id,'release','v13_terminal_no_result' FROM billing_test_usage u JOIN grading_submissions s ON s.id=u.submission_id
JOIN grading_jobs j ON j.submission_id=s.id
WHERE s.status IN('failed','rejected','cancelled','expired','unsupported') AND j.state='done' AND j.lease_until IS NULL
AND NOT EXISTS(SELECT 1 FROM grading_results r WHERE r.submission_id=s.id AND r.is_graded)
AND NOT EXISTS(SELECT 1 FROM grading_runs r WHERE r.submission_id=s.id AND (r.outcome IS NULL OR r.finished_at IS NULL));
