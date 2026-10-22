#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$APP_DB_PASSWORD" --set=ops_password="$OPS_DB_PASSWORD" <<'SQL'
CREATE ROLE botai_app LOGIN PASSWORD :'app_password';
CREATE ROLE botai_operator LOGIN PASSWORD :'ops_password';
GRANT CONNECT ON DATABASE botai TO botai_app, botai_operator;
GRANT USAGE ON SCHEMA public TO botai_app, botai_operator;
ALTER DEFAULT PRIVILEGES FOR ROLE botai_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO botai_app;
ALTER DEFAULT PRIVILEGES FOR ROLE botai_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO botai_app;
ALTER ROLE botai_operator SET default_transaction_read_only = on;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
