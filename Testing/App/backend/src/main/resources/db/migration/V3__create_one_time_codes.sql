-- One-time email codes: passwordless login and password reset.
-- The code itself is never stored - only its salted SHA-256 (see OneTimeCodeService).
CREATE TABLE one_time_codes (
    id          UUID PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     VARCHAR(32) NOT NULL,
    code_hash   VARCHAR(64) NOT NULL,
    attempts    INT         NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX one_time_codes_user_purpose_ix
    ON one_time_codes (user_id, purpose, created_at DESC);
