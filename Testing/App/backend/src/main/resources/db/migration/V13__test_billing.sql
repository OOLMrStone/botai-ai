-- Test billing is deliberately independent of users.plan_id and production plans.
CREATE TABLE billing_test_payments (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    idempotency_key varchar(64) NOT NULL,
    offer_id varchar(64) NOT NULL,
    plan varchar(16) NOT NULL CHECK (plan IN ('light','core','heavy')),
    period varchar(8) NOT NULL CHECK (period IN ('month','season')),
    amount_minor integer NOT NULL CHECK (amount_minor > 0),
    checks_total integer NOT NULL CHECK (checks_total > 0),
    duration_days integer,
    fixed_expiry timestamptz,
    return_url text NOT NULL,
    shop_id varchar(32) NOT NULL,
    provider_key uuid NOT NULL UNIQUE,
    provider_request text NOT NULL CHECK (octet_length(provider_request) <= 8192),
    provider_id varchar(64) UNIQUE,
    status varchar(32) NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','pending','waiting_for_capture','succeeded','canceled','review_required')),
    confirmation_url text,
    cancellation_reason varchar(64),
    first_dispatch_at timestamptz,
    lease_until timestamptz,
    lease_token uuid,
    next_check_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(user_id,idempotency_key),
    CHECK ((duration_days = 30 AND fixed_expiry IS NULL) OR (duration_days IS NULL AND fixed_expiry IS NOT NULL))
);
CREATE INDEX billing_test_reconcile_idx ON billing_test_payments(next_check_at) WHERE status IN ('creating','pending','waiting_for_capture');
CREATE TABLE billing_test_entitlements (
    payment_id uuid PRIMARY KEY REFERENCES billing_test_payments(id),
    user_id uuid NOT NULL REFERENCES users(id),
    plan varchar(16) NOT NULL,
    starts_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    checks_total integer NOT NULL CHECK (checks_total > 0),
    CHECK (expires_at > starts_at)
);
CREATE INDEX billing_test_entitlement_user_idx ON billing_test_entitlements(user_id,expires_at);
CREATE TABLE billing_test_usage (
    submission_id uuid PRIMARY KEY REFERENCES grading_submissions(id),
    payment_id uuid NOT NULL REFERENCES billing_test_entitlements(payment_id),
    consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX billing_test_usage_payment_idx ON billing_test_usage(payment_id);
