CREATE TABLE users (
    id            UUID PRIMARY KEY,
    email         VARCHAR(320) NOT NULL,
    -- BCrypt hash (the salt is embedded in the hash string itself).
    -- NULL for accounts created through an external provider (e.g. Google).
    password_hash VARCHAR(100),
    display_name  VARCHAR(100),
    role          VARCHAR(32)  NOT NULL DEFAULT 'USER',
    -- External identity provider support: LOCAL for password accounts,
    -- GOOGLE etc. for social logins. provider_id is the subject id ("sub")
    -- issued by the external provider.
    auth_provider VARCHAR(32)  NOT NULL DEFAULT 'LOCAL',
    provider_id   VARCHAR(255),
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Emails are unique case-insensitively (the service layer also normalizes
-- to lowercase before persisting).
CREATE UNIQUE INDEX users_email_ux ON users (lower(email));

-- One account per external identity.
CREATE UNIQUE INDEX users_provider_ux ON users (auth_provider, provider_id)
    WHERE provider_id IS NOT NULL;
