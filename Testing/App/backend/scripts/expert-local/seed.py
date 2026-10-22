#!/usr/bin/env python3
"""Idempotent explicit local fixture. Accounts use normal BCrypt registration."""
import json
import argparse
import time
import uuid
from common import Client, ROOT, RUNTIME, credentials, db, sql_literal

SCHOOL = '55000000-0000-4000-8000-000000000001'
OTHER_SCHOOL = '55000000-0000-4000-8000-000000000002'

def create_work(student, expert, school):
    owner = Client(student)
    attempt = owner.request('POST', '/api/training-attempts', {
        'formatId': 'ege-profile-20-v1', 'selections': [{'examNumber': 16, 'count': 1}]
    }, headers={'Idempotency-Key': str(uuid.uuid4())})
    item = attempt['items'][0]
    submission = owner.request('POST', '/api/submissions', {
        'attemptId': attempt['id'], 'attemptItemId': item['id'], 'inputRevision': item['answerRevision']
    }, headers={'Idempotency-Key': str(uuid.uuid4())})
    # Existing original local graph fixture; only mock AI processes these bytes.
    asset = ROOT.parent / 'botai-front/public/tasks/mock-exam/task-11-graph.png'
    data = asset.read_bytes()
    boundary = 'expert-local-' + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="local-demo-graph.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
            + data + f'\r\n--{boundary}--\r\n'.encode())
    owner.request('POST', f'/api/submissions/{submission["id"]}/images', body,
                  headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    submission = owner.request('GET', '/api/submissions/' + submission['id'])
    owner.request('POST', f'/api/submissions/{submission["id"]}/finalize', {'expectedRevision': submission['revision']})
    for _ in range(60):
        submission = owner.request('GET', '/api/submissions/' + submission['id'])
        if submission['status'] not in ('queued', 'running'):
            break
        time.sleep(0.5)
    assert submission['status'] == 'graded' and submission['result']['isDemo'], 'Expected real local mock grading result'
    routed = owner.request('POST', f'/api/submissions/{submission["id"]}/expert-review', {'schoolId': school})
    repeated = owner.request('POST', f'/api/submissions/{submission["id"]}/expert-review', {'schoolId': school})
    assert routed['id'] == repeated['id'], 'Routing must be idempotent'
    return {'workId': routed['id'], 'submissionId': submission['id'], 'attemptId': attempt['id'], 'student': student, 'expert': expert, 'schoolId': school}

def provision():
    accounts = credentials()
    for name, account in accounts.items():
        client = Client(login=False)
        existing = db(f'SELECT count(*) FROM users WHERE email={sql_literal(account["email"])};', query=True)
        if existing == '0':
            client.request('POST', '/api/auth/register', {**account, 'displayName': 'Local demo ' + name}, expected=201)
    ids = {name: db(f'SELECT id FROM users WHERE email={sql_literal(account["email"])};', query=True) for name, account in accounts.items()}
    statements = ['BEGIN;']
    for name, account in accounts.items():
        role = 'EXPERT' if 'expert' in name else 'USER'
        statements.append(f"UPDATE users SET role='{role}',plan_id='pro',email_verified=true WHERE id={sql_literal(ids[name])} AND email={sql_literal(account['email'])} AND password_hash LIKE '{{bcrypt}}%';")
    statements.append(f"INSERT INTO schools(id,name) VALUES ('{SCHOOL}','Локальная школа А'),('{OTHER_SCHOOL}','Локальная школа Б') ON CONFLICT DO NOTHING;")
    for name, school in [('expert', SCHOOL), ('same_school_expert', SCHOOL), ('other_expert', OTHER_SCHOOL)]:
        statements.append(f"INSERT INTO school_experts(school_id,user_id) VALUES ('{school}',{sql_literal(ids[name])}) ON CONFLICT DO NOTHING;")
    for name, school, first, last in [('student', SCHOOL, 'Анна', 'Демонстрационная'), ('second_student', SCHOOL, 'Иван', 'Примеров'), ('other_student', OTHER_SCHOOL, 'Мария', 'Другая')]:
        statements.append(f"INSERT INTO school_students(school_id,user_id,first_name,last_name,contact) VALUES ('{school}',{sql_literal(ids[name])},{sql_literal(first)},{sql_literal(last)},'Синтетическая локальная запись') ON CONFLICT DO NOTHING;")
    statements.append('COMMIT;')
    db('\n'.join(statements))
    for expert, student in [('expert', 'student'), ('same_school_expert', 'second_student'), ('other_expert', 'other_student')]:
        Client(expert).request('POST', '/api/expert/students', {'studentId': ids[student]})
    manifest = RUNTIME / 'fixtures.json'
    if manifest.exists():
        return json.loads(manifest.read_text())
    fixtures = {'schoolId': SCHOOL, 'otherSchoolId': OTHER_SCHOOL, 'userIds': ids, 'works': [
        create_work('student', 'expert', SCHOOL),
        create_work('student', 'expert', SCHOOL),
        create_work('second_student', 'same_school_expert', SCHOOL),
        create_work('other_student', 'other_expert', OTHER_SCHOOL),
    ]}
    manifest.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + '\n')
    manifest.chmod(0o600)
    return fixtures

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--replace-queued-demos', action='store_true', help='Archive only these generated queued fixtures and recreate through HTTP; preserve accounts and immutable AI origins')
    args = parser.parse_args()
    fixtures = provision()
    if args.replace_queued_demos:
        allowed = {account['email']: name for name, account in credentials().items() if 'student' in name}
        rows = db("""SELECT coalesce(json_agg(json_build_object('workId',w.id,'attemptId',a.id,'email',u.email)), '[]'::json)
            FROM expert_works w JOIN users u ON u.id=w.student_user_id
            JOIN grading_submissions gs ON gs.id=w.submission_id
            JOIN attempts a ON a.id=coalesce(gs.attempt_id,gs.requested_attempt_id)
            WHERE w.status='queued' AND w.revision=0 AND w.ai_document ? 'blocks' AND a.deleted_at IS NULL
            AND u.email IN (""" + ','.join(sql_literal(email) for email in allowed) + ');', query=True)
        obsolete = json.loads(rows)
        obsolete_ids = {entry['workId'] for entry in obsolete}
        stamp = str(int(time.time()))
        archive = RUNTIME / ('fixtures-replaced-' + stamp + '.json')
        archive.write_text(json.dumps({'previousFixtures': fixtures, 'obsoleteQueuedWorks': obsolete}, ensure_ascii=False, indent=2) + '\n')
        archive.chmod(0o600)
        for entry in obsolete:
            Client(allowed[entry['email']]).request('DELETE', '/api/attempts/' + entry['attemptId'], expected=204)
        fixtures['replacedWorkIds'] = sorted(obsolete_ids)
        fixtures['works'] = [create_work(fixture['student'], fixture['expert'], fixture['schoolId']) if fixture['workId'] in obsolete_ids else fixture for fixture in fixtures['works']]
        (RUNTIME / 'fixtures.json').write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + '\n')
        (RUNTIME / 'fixtures.json').chmod(0o600)
    print('Expert-local demo provisioned: two schools, three experts, three students, four real mock-AI works. Private credentials preserved.')
