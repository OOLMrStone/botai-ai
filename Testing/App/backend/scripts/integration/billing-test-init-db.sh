#!/bin/sh
set -eu
test "$POSTGRES_DB" = botai_payments_test
test "$POSTGRES_USER" = botai_billing_migrator
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE botai_billing_app LOGIN PASSWORD :'app_password';
REVOKE ALL ON DATABASE botai_payments_test FROM PUBLIC;
GRANT CONNECT ON DATABASE botai_payments_test TO botai_billing_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO botai_billing_app;
-- Actual grants are applied after the one-shot initializer, excluding Flyway history.
SQL
