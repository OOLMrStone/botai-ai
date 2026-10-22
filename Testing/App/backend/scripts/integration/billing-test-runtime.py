#!/usr/bin/env python3
"""Initialize/provision only the isolated local billing sandbox; never print secrets."""
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'runtime/evidence/billing-test'
COMPOSE = ROOT / 'scripts/integration/billing-test-compose.sh'
EMAIL = 'billing-test@botai.test'


def private_write(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as target:
        target.write(content)


def env_write(name, values):
    private_write(PRIVATE / name, ''.join(f'{key}={value}\n' for key, value in values.items()))


def initialize():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    if PRIVATE.is_symlink():
        raise SystemExit('Refusing a symlinked private directory')
    PRIVATE.chmod(0o700)
    names = ['compose.env', 'postgres.env', 'backend.env', 'migrate.env', 'garage.env', 'garage.toml', 'ai.env', 'fixture.json']
    if any((PRIVATE / name).exists() or (PRIVATE / name).is_symlink() for name in names):
        raise SystemExit('Sandbox credentials already exist; preserve them (no automatic rotation)')
    pg = secrets.token_hex(32)
    app = secrets.token_hex(32)
    s3key = 'GK' + secrets.token_hex(16)
    s3secret = secrets.token_hex(32)
    ai = secrets.token_hex(32)
    env_write('compose.env', {'BILLING_TEST_MODE': 'disabled'})
    env_write('postgres.env', {'POSTGRES_DB': 'botai_payments_test', 'POSTGRES_USER': 'botai_billing_migrator', 'POSTGRES_PASSWORD': pg, 'APP_DB_PASSWORD': app})
    env_write('migrate.env', {'APP_MIGRATION_JDBC_URL': 'jdbc:postgresql://postgres:5432/botai_payments_test', 'APP_MIGRATION_USER': 'botai_billing_migrator', 'APP_MIGRATION_PASSWORD': pg})
    env_write('backend.env', {
        'SPRING_DATASOURCE_URL': 'jdbc:postgresql://postgres:5432/botai_payments_test',
        'SPRING_DATASOURCE_USERNAME': 'botai_billing_app', 'SPRING_DATASOURCE_PASSWORD': app,
        'APP_STORAGE_ENDPOINT': 'http://garage:3900', 'APP_STORAGE_BUCKET': 'botai-billing-test',
        'APP_STORAGE_ACCESS_KEY': s3key, 'APP_STORAGE_SECRET_KEY': s3secret, 'APP_STORAGE_REGION': 'garage',
        'APP_GRADING_BASE_URL': 'http://ai:8000', 'APP_GRADING_TOKEN': ai,
    })
    env_write('garage.env', {'GARAGE_DEFAULT_ACCESS_KEY': s3key, 'GARAGE_DEFAULT_SECRET_KEY': s3secret, 'GARAGE_DEFAULT_BUCKET': 'botai-billing-test'})
    env_write('ai.env', {'INTERNAL_GRADING_TOKEN': ai})
    private_write(PRIVATE / 'garage.toml', f'''metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "{secrets.token_hex(32)}"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
''')
    private_write(PRIVATE / 'fixture.json', json.dumps({
        'purpose': 'local YooKassa sandbox only', 'origin': 'http://localhost:13002',
        'email': EMAIL, 'password': secrets.token_urlsafe(32), 'role': 'USER', 'plan': 'free',
    }, indent=2) + '\n')
    print('Created dedicated sandbox credentials; billing disabled; no provider credentials read or generated')


def sql(statement):
    result = subprocess.run([str(COMPOSE), 'exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'botai_billing_migrator', '-d', 'botai_payments_test'],
                            input=statement, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit('Sandbox SQL failed; inspect privately (no SQL or credential output)')
    return result.stdout.strip()


def grants():
    if sql('SELECT current_database()') != 'botai_payments_test':
        raise SystemExit('Database guard failed')
    current = sql("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1")
    if current not in {'13', '14'}:
        raise SystemExit('Expected initialized V13 or V14 sandbox')
    sql('''GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO botai_billing_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO botai_billing_app;
REVOKE ALL ON flyway_schema_history FROM botai_billing_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,botai_billing_app;
''')
    print(f'V{current} sandbox app DML granted; Flyway history and DDL remain unavailable to app')


def provision():
    if sql('SELECT current_database()') != 'botai_payments_test':
        raise SystemExit('Database guard failed')
    fixture = json.loads((PRIVATE / 'fixture.json').read_text())
    if fixture['email'] != EMAIL or fixture['role'] != 'USER' or fixture['plan'] != 'free':
        raise SystemExit('Unexpected fixture identity')
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    base = 'http://127.0.0.1:18084'
    with opener.open(base + '/api/auth/csrf', timeout=10) as response:
        csrf = json.load(response)
    payload = json.dumps({'email': EMAIL, 'password': fixture['password'], 'displayName': 'Тест ЮKassa'}).encode()
    request = urllib.request.Request(base + '/api/auth/register', payload, {'Content-Type': 'application/json', csrf['headerName']: next(c.value for c in jar if c.name == 'XSRF-TOKEN')})
    try:
        with opener.open(request, timeout=15) as response:
            if response.status != 201:
                raise SystemExit('Registration failed')
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise SystemExit(f'Sandbox registration failed HTTP {error.code}')
    sql("UPDATE users SET email_verified=true WHERE email='billing-test@botai.test' AND role='USER' AND plan_id='free';")
    if sql("SELECT count(*) FROM users WHERE email='billing-test@botai.test' AND role='USER' AND plan_id='free' AND email_verified") != '1':
        raise SystemExit('Fixture access assertion failed')
    print('One dedicated verified USER/free account ready; password retained only in private fixture.json')


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['init', 'grants', 'provision'])
args = parser.parse_args()
{'init': initialize, 'grants': grants, 'provision': provision}[args.action]()
