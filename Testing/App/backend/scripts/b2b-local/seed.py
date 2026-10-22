#!/usr/bin/env python3
"""Provision school-only assignments; never submit, finalize or call AI."""
import argparse
import hashlib
import json
import os
import subprocess
import uuid
from common import (RUNTIME, COMPOSE, FIXTURE_NAMESPACE, Client, assert_isolated,
                    assert_local_docker, credentials, db, private_file, sql_literal as q)

SCHOOL = str(uuid.uuid5(FIXTURE_NAMESPACE, 'school'))


def identifier(kind, case_id):
    return str(uuid.uuid5(FIXTURE_NAMESPACE, kind + ':' + case_id))


def package():
    directory = RUNTIME / 'fixtures-package'
    path = directory / 'package.json'
    if directory.is_symlink() or path.is_symlink():
        raise RuntimeError('Private package symlink forbidden')
    value = json.loads(path.read_text())
    if value.get('schemaVersion') != 1 or not 1 <= len(value.get('cases', [])) <= 1000:
        raise RuntimeError('Expected prepared bounded package')
    if len({case['id'] for case in value['cases']}) != len(value['cases']):
        raise RuntimeError('Duplicate package case')
    for case in value['cases']:
        if case['taskNumber'] not in (14, 15, 16, 17, 18, 19, 20) or case['referenceSolution'] is not None:
            raise RuntimeError('Invalid immutable school task')
        for asset in [item for values in case['files'].values() for item in (values if isinstance(values, list) else [values])]:
            source = directory / asset['path']
            if source.is_symlink() or directory.resolve() not in source.resolve().parents:
                raise RuntimeError('Unsafe private asset')
            raw = source.read_bytes()
            if len(raw) != asset['sizeBytes'] or hashlib.sha256(raw).hexdigest() != asset['sha256']:
                raise RuntimeError('Private package integrity failure')
    return value


def existing(table, columns, object_id):
    # Table/columns are fixed source constants, never supplied by the manifest/browser.
    fields = ','.join(q(column) + ',' + column for column in columns)
    row = db(f'SELECT json_build_object({fields}) FROM {table} WHERE id={q(object_id)};', query=True)
    return json.loads(row) if row else None


def insert_preserving(table, row):
    previous = existing(table, row.keys(), row['id'])
    if previous is not None:
        if previous != row:
            raise RuntimeError('Existing immutable B2B fixture differs; no replacement allowed')
        return
    values = []
    for key, value in row.items():
        if value is None:
            values.append('NULL')
        elif isinstance(value, bool):
            values.append('true' if value else 'false')
        elif isinstance(value, (list, dict)):
            values.append(q(json.dumps(value, ensure_ascii=False)) + '::jsonb')
        else:
            values.append(q(value))
    db(f'INSERT INTO {table}({",".join(row)}) VALUES({",".join(values)}) ON CONFLICT DO NOTHING;')
    if existing(table, row.keys(), row['id']) != row:
        raise RuntimeError('Fixture insert conflict; existing immutable records preserved')


def configure_operator(user_id):
    path = RUNTIME / '.env'
    if path.is_symlink():
        raise RuntimeError('Private env symlink forbidden')
    text = path.read_text()
    lines = text.splitlines()
    matches = [index for index, line in enumerate(lines) if line.startswith('APP_B2B_OPERATOR_USER_IDS=')]
    if len(matches) != 1:
        raise RuntimeError('Expected exactly one private operator allowlist')
    index = matches[0]
    current = [part for part in lines[index].split('=', 1)[1].split(',') if part]
    if user_id in current:
        return False
    current.append(user_id)
    lines[index] = 'APP_B2B_OPERATOR_USER_IDS=' + ','.join(current)
    temporary = RUNTIME / ('.env-update-' + uuid.uuid4().hex)
    private_file(temporary, '\n'.join(lines) + '\n')
    os.replace(temporary, path)
    return True


def validate_receipt(path, receipt):
    if path.is_symlink():
        raise RuntimeError('Private receipt symlink forbidden')
    assets = receipt.get('assets', [])
    current = {asset['id']: asset for asset in assets}
    if len(current) != len(assets):
        raise RuntimeError('Duplicate receipt asset ID')
    if path.exists():
        previous = json.loads(path.read_text())
        if any(current.get(asset['id']) != asset for asset in previous['assets']):
            raise RuntimeError('Existing private receipt asset differs; preserved')


def persist_receipt(path, receipt):
    validate_receipt(path, receipt)
    temporary = path.parent / ('.receipt-update-' + uuid.uuid4().hex)
    private_file(temporary, json.dumps(receipt, indent=2) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan-only', action='store_true', help='Check private package only; no Docker/DB/auth requests')
    args = parser.parse_args()
    assert_isolated()
    fixture_package = package()
    manifest = RUNTIME / 'fixtures.json'
    if manifest.is_symlink():
        raise RuntimeError('Private fixture manifest symlink forbidden')
    if args.plan_only:
        print('PASS: prepared assignments, one synthetic student/expert/school; no B2C target or AI run.')
        return
    assert_local_docker()
    tables = db("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN('school_tasks','school_assignments','school_task_assets');", query=True)
    if tables != '3':
        raise RuntimeError('Accepted B2B schema must be migrated before seed')
    accounts = credentials()
    for name, account in accounts.items():
        count = db('SELECT count(*) FROM users WHERE email=' + q(account['email']) + ';', query=True)
        if count == '0':
            Client().request('POST', '/api/auth/register', {**account, 'displayName':
                'Алексей Смирнов' if name == 'student' else 'Мария Орлова'}, expected=201)
    ids = {name: db('SELECT id FROM users WHERE email=' + q(account['email']) + ';', query=True)
           for name, account in accounts.items()}
    for value in ids.values():
        uuid.UUID(value)
    statements = ['BEGIN;']
    for name, account in accounts.items():
        role = 'EXPERT' if name == 'expert' else 'USER'
        statements.append(f'UPDATE users SET role={q(role)},email_verified=true WHERE id={q(ids[name])} AND email={q(account["email"])} AND password_hash LIKE \'{{bcrypt}}%\';')
    statements.extend([
        f'INSERT INTO schools(id,name) VALUES({q(SCHOOL)},\'Математика\') ON CONFLICT DO NOTHING;',
        f'INSERT INTO school_experts(school_id,user_id) VALUES({q(SCHOOL)},{q(ids["expert"])}) ON CONFLICT DO NOTHING;',
        f'INSERT INTO school_students(school_id,user_id,first_name,last_name,contact) VALUES({q(SCHOOL)},{q(ids["student"])},\'Алексей\',\'Смирнов\',NULL) ON CONFLICT DO NOTHING;',
        'COMMIT;'])
    db('\n'.join(statements))
    Client('expert').request('POST', '/api/expert/students', {'studentId': ids['student']})
    # Only an already accepted/built local image is allowed; pull_policy=never prevents registry fallback.
    result = subprocess.run([str(COMPOSE), '--profile', 'ops', 'run', '--rm', '--no-deps', 'asset-seed'],
                             capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Private task asset preparation failed; diagnostics withheld')
    receipt = json.loads(result.stdout)
    validate_receipt(RUNTIME / 'asset-receipt.json', receipt)
    assets = receipt['assets']
    if len(assets) != sum(2 + (len(c['files']['studentSolution']) if isinstance(c['files']['studentSolution'], list) else 1) for c in fixture_package['cases']):
        raise RuntimeError('Expected task and ordered solution assets for every case')
    fixtures = []
    for case in fixture_package['cases']:
        task_id = identifier('task', case['id'])
        assignment_id = identifier('assignment', case['id'])
        case_assets = [asset for asset in assets if asset['caseId'] == case['id']]
        if not 3 <= len(case_assets) <= 6 or not {'statement', 'reference'} <= {asset['kind'] for asset in case_assets}:
            raise RuntimeError('Missing scoped task assets')
        statement_asset = next(asset for asset in case_assets if asset['kind'] == 'statement')
        content = case['content'] + [{'type': 'image', 'alt': 'Оригинальное условие задания',
            'assetId': statement_asset['id']}]
        insert_preserving('school_tasks', {'id': task_id, 'school_id': SCHOOL,
            'task_number': case['taskNumber'], 'max_score': case['maxScore'], 'title': case['title'],
            'statement': case['statement'], 'content': content, 'reference_answer': case['referenceAnswer'],
            'reference_solution': None, 'is_demo': False, 'input_mode': case.get('inputMode', 'prepared')})
        for asset in case_assets:
            if (asset['taskId'] != task_id or asset['id'] != identifier('asset', case['id'] + ':' + asset['kind'])
                    or asset['bucket'] != 'botai' or asset['mimeType'] != 'image/jpeg'
                    or not asset['objectKey'].startswith('b2b-seed/' + asset['id'] + '/')):
                raise RuntimeError('Invalid private asset receipt')
            if asset['kind'].startswith('solution-'):
                insert_preserving('school_solution_fixtures', {'id': asset['id'], 'task_id': task_id,
                    'ordinal': int(asset['kind'].split('-')[1]), 'object_key': asset['objectKey'],
                    'size_bytes': asset['sizeBytes'], 'sha256': asset['sha256']})
                continue
            insert_preserving('school_task_assets', {'id': asset['id'], 'school_id': SCHOOL,
                'task_id': task_id, 'kind': asset['kind'], 'bucket': asset['bucket'],
                'object_key': asset['objectKey'], 'file_name': asset['fileName'],
                'mime_type': asset['mimeType'], 'size_bytes': asset['sizeBytes'], 'sha256': asset['sha256']})
        # Existing disabled/closed assignments stay disabled/closed; immutable target is checked only.
        insert_preserving('school_assignments', {'id': assignment_id, 'school_id': SCHOOL,
            'student_user_id': ids['student'], 'task_id': task_id, 'title': case['title']})
        fixtures.append({'caseId': case['id'], 'taskId': task_id, 'assignmentId': assignment_id,
                         'taskNumber': case['taskNumber'], 'assetIds': {asset['kind']: asset['id'] for asset in case_assets}})
    allowlist_changed = configure_operator(ids['expert'])
    record = {'schemaVersion': 1, 'schoolId': SCHOOL, 'userIds': ids,
              'sourceManifestSha256': fixture_package['sourceManifestSha256'], 'assignments': fixtures}
    serialized = json.dumps(record, ensure_ascii=False, indent=2) + '\n'
    if manifest.exists():
        previous = json.loads(manifest.read_text())
        if previous['schoolId'] != SCHOOL or previous['userIds'] != ids:
            raise RuntimeError('Existing fixture accounts differ')
        current = {item['caseId']: item for item in fixtures}
        for item in previous['assignments']:
            updated = current.get(item['caseId'], {})
            if any(updated.get(key) != val for key, val in item.items() if key != 'assetIds') or any(updated.get('assetIds', {}).get(key) != val for key, val in item['assetIds'].items()):
                raise RuntimeError('Existing private fixture IDs differ; preserved')
    if manifest.exists():
        temporary = RUNTIME / ('.fixtures-update-' + uuid.uuid4().hex)
        private_file(temporary, serialized)
        temporary.replace(manifest)
    else:
        private_file(manifest, serialized)
    persist_receipt(RUNTIME / 'asset-receipt.json', receipt)
    print('School seed ready: prepared assignments, one student/expert/school; no submissions or AI calls.')
    if allowlist_changed:
        print('Private operator allowlist updated; recreate only B2B backend to apply it before developer QA.')


if __name__ == '__main__':
    main()
