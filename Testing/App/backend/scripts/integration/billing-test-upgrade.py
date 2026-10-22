#!/usr/bin/env python3
"""Guarded additive V13->V14 LOCAL sandbox upgrade. Leaves backend stopped for coordinated restart."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'runtime/evidence/billing-test'
COMPOSE = ROOT / 'scripts/integration/billing-test-compose.sh'
PROJECT = 'botai-billing-test'
DATABASE = 'botai_payments_test'
OWNER = 'botai_billing_migrator'
APP = 'botai_billing_app'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(command, *, stdin=None, env=None, binary=False):
    result = subprocess.run(command, cwd=ROOT, input=stdin, capture_output=True, text=not binary, env=env)
    require(result.returncode == 0, 'Operator command failed; output withheld to protect credentials')
    return result.stdout


def compose(*args, **kwargs):
    return run([str(COMPOSE), *args], **kwargs)


def sql(statement):
    return compose('exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', OWNER, '-d', DATABASE, stdin=statement).strip()


def private_json(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as target:
        json.dump(value, target, indent=2); target.write('\n')


def container(service):
    info = json.loads(run(['docker', 'inspect', f'{PROJECT}-{service}-1']))[0]
    require(info['Config']['Labels'].get('com.docker.compose.project') == PROJECT, 'Wrong Compose project')
    require(info['Config']['Labels'].get('com.docker.compose.service') == service, 'Wrong service')
    return info


def quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def schema_columns():
    return json.loads(sql("""SELECT jsonb_object_agg(table_name,columns) FROM (
      SELECT c.table_name,jsonb_agg(c.column_name ORDER BY c.ordinal_position) columns
      FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
        AND c.table_name<>'flyway_schema_history' GROUP BY c.table_name) q;"""))


def fingerprints(columns):
    # Old column list stays fixed across additive migration; no row values enter receipts/stdout.
    result = {}
    for table, names in sorted(columns.items()):
        projection = ','.join(quote(name) for name in names)
        rows = sql(f'SELECT row_to_json(q)::text FROM (SELECT {projection} FROM public.{quote(table)}) q ORDER BY row_to_json(q)::text;')
        result[table] = {'count': int(sql(f'SELECT count(*) FROM public.{quote(table)};')),
                         'sha256': hashlib.sha256(rows.encode()).hexdigest()}
    return result


def history():
    # Includes checksums and installation metadata for every original migration row.
    value = sql("SELECT row_to_json(h)::text FROM public.flyway_schema_history h WHERE installed_rank<=13 ORDER BY installed_rank;")
    return hashlib.sha256(value.encode()).hexdigest()


def version():
    return sql('SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1;')


def upgrade(image):
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'Require exact locally built image ID')
    require(PRIVATE.is_dir() and not PRIVATE.is_symlink(), 'Missing private runtime directory')
    env_file = PRIVATE / 'migrate.env'
    require(not env_file.is_symlink() and env_file.stat().st_mode & 0o777 == 0o600, 'Migration env must be private0600')
    env_values = dict(line.split('=', 1) for line in env_file.read_text().splitlines() if line)
    require(set(env_values) == {'APP_MIGRATION_JDBC_URL', 'APP_MIGRATION_USER', 'APP_MIGRATION_PASSWORD'}, 'Unexpected migrator environment keys')
    require(env_values['APP_MIGRATION_JDBC_URL'] == f'jdbc:postgresql://postgres:5432/{DATABASE}'
            and env_values['APP_MIGRATION_USER'] == OWNER and bool(env_values['APP_MIGRATION_PASSWORD']), 'Wrong sandbox migration target')
    pg = container('postgres'); backend = container('backend')
    require(pg['State']['Running'] and backend['State']['Running'], 'Expected running sandbox services before coordinated upgrade')
    require(any(m.get('Name') == PROJECT + '_postgres-data' and m.get('Destination') == '/var/lib/postgresql/data' for m in pg['Mounts']), 'Unexpected PostgreSQL volume')
    require(run(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).strip() == image, 'Candidate image not present')
    require(sql('SELECT current_database()') == DATABASE and version() == '13', 'Upgrade only existing local V13 sandbox')
    require(sql('SELECT count(*) FROM flyway_schema_history WHERE success;') == '13', 'Unexpected migration history')
    require(sql('SELECT count(*) FROM flyway_schema_history WHERE NOT success;') == '0', 'Failed migration history')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    destination = PRIVATE / ('upgrade-v14-' + stamp)
    destination.mkdir(mode=0o700)
    receipt = {'database': DATABASE, 'sourceVersion': 13, 'targetVersion': 14, 'candidateImage': image,
               'previousImage': backend['Image'], 'backendRestarted': False}
    try:
        compose('stop', '--timeout', '30', 'backend')
        require(not container('backend')['State']['Running'], 'Backend must be quiescent')
        columns = schema_columns(); before = fingerprints(columns); before_history = history()
        private_json(destination / 'before.json', {'columns': columns, 'tables': before, 'historyV1toV13': before_history})
        dump = compose('exec', '-T', 'postgres', 'pg_dump', '-U', OWNER, '-d', DATABASE, '--format=custom', binary=True)
        with os.fdopen(os.open(destination / 'before.dump', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as output:
            output.write(dump)
        compose('exec', '-T', 'postgres', 'pg_restore', '--list', stdin=dump, binary=True)
        receipt['backupSha256'] = hashlib.sha256(dump).hexdigest()
        receipt['backupFormatReadable'] = True
        env = dict(os.environ, BILLING_TEST_BACKEND_IMAGE=image)
        first = compose('run', '--rm', '--no-deps', 'migrate', env=env)
        require('MIGRATION_OK before=13 after=14 executed=1' in first, 'Migration did not confirm V13 to V14')
        require(version() == '14' and history() == before_history, 'Original Flyway history changed')
        require(fingerprints(columns) == before, 'Existing rows changed; leave backend stopped for review')
        replay = compose('run', '--rm', '--no-deps', 'migrate', env=env)
        require('MIGRATION_OK before=14 after=14 executed=0' in replay, 'Migration replay failed')
        sql(f'''GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {APP};
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP};
REVOKE ALL ON flyway_schema_history FROM {APP};
REVOKE CREATE ON SCHEMA public FROM PUBLIC,{APP};''')
        grants = json.loads(sql(f"""SELECT jsonb_build_object(
          'unsafeRole',rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls,
          'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=r.oid),
          'ownsDatabase',(SELECT datdba=r.oid FROM pg_database WHERE datname=current_database()),
          'ownedRelations',(SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=r.oid),
          'schemaCreate',has_schema_privilege(r.oid,'public','CREATE'),
          'flywayPrivilege',has_table_privilege(r.oid,'public.flyway_schema_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
          'missingTableDml',(SELECT count(*) FROM pg_tables t WHERE t.schemaname='public' AND t.tablename<>'flyway_schema_history'
             AND NOT (has_table_privilege(r.oid,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'SELECT')
               AND has_table_privilege(r.oid,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'INSERT')
               AND has_table_privilege(r.oid,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'UPDATE')
               AND has_table_privilege(r.oid,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'DELETE'))))
          FROM pg_roles r WHERE rolname='{APP}';"""))
        require(all(value is False or value == 0 for value in grants.values()), 'App privilege check failed')
        receipt.update({'status': 'PASS', 'oldTablesPreserved': len(before), 'historyV1toV13Unchanged': True,
                        'migrationReplayNoop': True, 'grants': grants, 'newTableCount': len(schema_columns()) - len(columns)})
        private_json(destination / 'receipt.json', receipt)
        print(f'UPGRADE_OK V13->V14; original rows/history preserved; app grants PASS; backend remains stopped; receipt={destination.relative_to(ROOT)}/receipt.json')
    except Exception:
        receipt['status'] = 'FAILED; backend remains stopped; no automatic database restore'
        private_json(destination / 'failure.json', receipt)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true', help='Execute only after coordinated runtime upgrade authorization')
    parser.add_argument('--image', required=True, help='Exact reviewed local backend sha256 image ID')
    args = parser.parse_args()
    if not args.execute:
        parser.error('--execute is required; this command stops only the isolated sandbox backend')
    try:
        upgrade(args.image)
    except Exception as error:
        print('UPGRADE_FAILED: ' + str(error) if isinstance(error, RuntimeError) else 'UPGRADE_FAILED: details withheld; inspect private receipt')
        raise SystemExit(1)
