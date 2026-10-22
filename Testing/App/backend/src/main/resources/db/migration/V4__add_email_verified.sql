ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Accounts created before this feature existed cannot be asked to verify
-- retroactively, so they are grandfathered in. New rows get FALSE from the
-- default (external-provider accounts are marked verified on creation, since
-- the provider already asserts ownership of the address).
UPDATE users SET email_verified = TRUE;
