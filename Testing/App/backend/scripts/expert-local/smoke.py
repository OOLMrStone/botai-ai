#!/usr/bin/env python3
"""Real isolated HTTP chain plus authorization, revision and restart gates."""
import copy
import datetime
import json
import subprocess
import time
import uuid
from common import Client, COMPOSE, RUNTIME, db, sql_literal
from seed import create_work, provision

fixtures = provision()
expert = Client('expert')
other = Client('other_expert')
same_school = Client('same_school_expert')
student = Client('student')
Client(login=False).request('GET', '/api/expert/me', expected=401)
student.request('GET', '/api/expert/me', expected=403)
assert any(cookie.name == 'EXPERT_SESSION' and cookie.has_nonstandard_attr('HttpOnly') for cookie in expert.jar)
identity = expert.request('GET', '/api/expert/me')
assert identity['school']['id'] == fixtures['schoolId']
students = expert.request('GET', '/api/expert/students')['items']
assert {entry['id'] for entry in students} == {fixtures['userIds']['student']}
expert.request('POST', '/api/expert/students', {'studentId': fixtures['userIds']['other_student']}, expected=404)
expert.request('POST', '/api/expert/students', {'studentId': str(uuid.uuid4())}, expected=404)
same_school.request('POST', '/api/expert/students', {'studentId': fixtures['userIds']['student']}, expected=409)
expert.request('POST', '/api/expert/students', {'studentId': fixtures['userIds']['student']}, expected=403, csrf=False)

# Each invocation tests a new work. Existing demo queues/final work stay intact.
fixture = create_work('student', 'expert', fixtures['schoolId'])
path = '/api/expert/works/' + fixture['workId']
work = expert.request('GET', path)
assert work['status'] == 'queued' and work['review']['schema_version'] == 'expert-review.v1'
assert work['review']['origin'] == 'legacy_adapter'
assert fixture['workId'] in {entry['id'] for entry in expert.request('GET', '/api/expert/works?status=queued')['items']}
assert work['aiResult']['schema_version'] == 'expert-review.v1'
assert work['isDemo'] is True
initial = work['aiResult']
assert initial == work['review'] and initial['origin'] == 'legacy_adapter'
assert set(initial) == {'schema_version', 'origin', 'phase', 'solution_image_ids', 'ocr', 'analysis', 'grading', 'rejection_reason'}
assert set(initial['ocr']['blocks'][0]) == {'id', 'content', 'sources'}
assert initial['ocr']['blocks'][0]['sources'] == []
assert initial['analysis']['block_reviews'][0]['status'] is None and initial['analysis']['block_reviews'][0]['explanation'] is None
assert set(initial['analysis']['checks']) == {'domain', 'transformations', 'completeness'}
for key in ('ocr', 'analysis', 'grading', 'rejection_reason'):
    assert key in initial, 'Canonical null fields must not disappear through global JSON NON_NULL'
encoded = json.dumps(work)
assert 'exactResponse' not in encoded and 'storageKey' not in encoded
image = work['images'][0]
media_path = image['previewUrl']
data, headers = expert.request('GET', media_path, raw=True)
assert data and 'no-store' in next(value for key, value in headers.items() if key.lower() == 'cache-control')
assert 'image/' in next(value for key, value in headers.items() if key.lower() == 'content-type')
for foreign in (other, same_school, student):
    foreign.request('GET', path, expected=404 if foreign is not student else 403)
for foreign in (other, same_school):
    foreign.request('GET', media_path, expected=404)
    foreign.request('PUT', path + '/draft', {'expectedRevision': work['revision'], 'document': work['review']}, expected=404)
assert expert.request('GET', '/api/expert/works?studentId=' + fixtures['userIds']['other_student'])['items'] == []
review_path = f'/api/submissions/{fixture["submissionId"]}/expert-review?schoolId={fixtures["schoolId"]}'
assert student.request('GET', review_path).get('document') is None

original_ai = copy.deepcopy(work['aiResult'])
ai_digest = db(f"SELECT md5(ai_document::text) FROM expert_works WHERE id={sql_literal(fixture['workId'])};", query=True)
source_digest_sql = f"SELECT md5(coalesce(exact_response,''))||':'||md5(coalesce(feedback::text,'')) FROM grading_results WHERE submission_id={sql_literal(fixture['submissionId'])};"
source_digest = db(source_digest_sql, query=True)
document = copy.deepcopy(work['review'])
document['origin'] = 'expert'
document['analysis']['summary'] = 'Локальная экспертная рецензия ' + str(uuid.uuid4())
for block_review in document['analysis']['block_reviews']:
    block_review['status'] = 'correct'
    block_review['explanation'] = 'Демонстрационная правка эксперта'
body = {'expectedRevision': work['revision'], 'document': document}
expert.request('PUT', path + '/draft', body, expected=403, csrf=False)
draft = expert.request('PUT', path + '/draft', body)
assert draft['status'] == 'draft' and draft['revision'] == work['revision'] + 1 and draft['aiResult'] == original_ai
assert draft['review']['ocr'] == original_ai['ocr'], 'Analysis editing must preserve independent OCR'
expert.request('PUT', path + '/draft', body, expected=409)
assert student.request('GET', review_path).get('document') is None

# An explicit OCR correction retains existing analysis; no unsanctioned AI rerun/reset.
analysis_before_ocr_edit = copy.deepcopy(document['analysis'])
document['ocr']['blocks'][0]['content']['text'] += '\nЛокальная ручная OCR-правка'
draft = expert.request('PUT', path + '/draft', {'expectedRevision': draft['revision'], 'document': document})
assert draft['review']['analysis'] == analysis_before_ocr_edit and draft['aiResult'] == original_ai

# Every read must evaluate current roster/membership/assignment, even in a live session.
def temporarily(update, restore, check):
    db(update)
    try:
        check()
    finally:
        db(restore)

school = sql_literal(fixtures['schoolId'])
expert_id = sql_literal(fixtures['userIds']['expert'])
student_id = sql_literal(fixtures['userIds']['student'])
temporarily(f'UPDATE school_experts SET enabled=false WHERE school_id={school} AND user_id={expert_id};',
            f'UPDATE school_experts SET enabled=true WHERE school_id={school} AND user_id={expert_id};',
            lambda: expert.request('GET', path, expected=403))
temporarily(f'UPDATE schools SET enabled=false WHERE id={school};',
            f'UPDATE schools SET enabled=true WHERE id={school};',
            lambda: expert.request('GET', '/api/expert/me', expected=403))
temporarily(f'UPDATE school_students SET enabled=false WHERE school_id={school} AND user_id={student_id};',
            f'UPDATE school_students SET enabled=true WHERE school_id={school} AND user_id={student_id};',
            lambda: expert.request('GET', path, expected=404))
def reassigned_denied():
    expert.request('GET', path, expected=404)
    expert.request('GET', media_path, expected=404)
    expert.request('PUT', path + '/draft', {'expectedRevision': draft['revision'], 'document': document}, expected=404)
    same_school.request('GET', path, expected=404)
temporarily(f'UPDATE expert_students SET expert_user_id={sql_literal(fixtures["userIds"]["same_school_expert"])} WHERE school_id={school} AND student_user_id={student_id};',
            f'UPDATE expert_students SET expert_user_id={expert_id} WHERE school_id={school} AND student_user_id={student_id};',
            reassigned_denied)

def restart():
    subprocess.run([COMPOSE, 'restart', 'backend'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    for _ in range(90):
        try:
            current = expert.request('GET', path)
            return current
        except Exception:
            time.sleep(1)
    raise AssertionError('Backend failed to recover after isolated restart')

persisted = restart()
assert persisted['review'] == document and persisted['revision'] == draft['revision'] and persisted['status'] == 'draft'
assert persisted['gradingStale'] is True
blocked = expert.request('POST', path + '/send', {'expectedRevision': persisted['revision'], 'document': document}, expected=409)
assert blocked['code'] == 'grading_stale'
# Real stage-only AI: change one analysis status; no OCR content/photos are sent to it.
document['analysis']['block_reviews'][0]['status'] = 'error'
document['analysis']['block_reviews'][0]['explanation'] = 'Синтетическая ошибка для grading-only smoke'
grade_body = {'expectedRevision': persisted['revision'], 'document': copy.deepcopy(document)}
grade_key = str(uuid.uuid4())
expert.request('POST', path + '/grade', grade_body, expected=403, csrf=False, headers={'Idempotency-Key': grade_key})
for foreign in (other, same_school):
    foreign.request('POST', path + '/grade', grade_body, expected=404, headers={'Idempotency-Key': str(uuid.uuid4())})
graded = expert.request('POST', path + '/grade', grade_body, headers={'Idempotency-Key': grade_key})
assert graded['gradeJob']['state'] == 'succeeded' and graded['revision'] == persisted['revision'] + 2
assert graded['gradingStale'] is False and graded['isDemo'] is True
assert graded['review']['ocr'] == document['ocr'] and graded['review']['analysis'] == document['analysis']
assert graded['review']['grading']['score'] == graded['maxScore'] - 1
assert 'mock' in graded['review']['grading']['criterion'].lower()
assert graded['aiResult'] == original_ai
job_id = graded['gradeJob']['id']
job_path = path + '/grade-jobs/' + job_id
assert expert.request('GET', job_path)['gradeJob']['state'] == 'succeeded'
for foreign in (other, same_school):
    foreign.request('GET', job_path, expected=404)
replay = expert.request('POST', path + '/grade', grade_body, headers={'Idempotency-Key': grade_key})
assert replay['gradeJob']['id'] == job_id and replay['revision'] == graded['revision']
conflicting = copy.deepcopy(grade_body)
conflicting['document']['analysis']['summary'] += ' Другой payload'
assert expert.request('POST', path + '/grade', conflicting, expected=409, headers={'Idempotency-Key': grade_key})['code'] == 'idempotency_conflict'
assert db(f"SELECT count(*) FROM expert_grading_jobs WHERE work_id={sql_literal(fixture['workId'])};", query=True) == '1'
document = graded['review']
sent = expert.request('POST', path + '/send', {'expectedRevision': graded['revision'], 'document': document})
assert sent['status'] == 'sent' and sent['sentAt'] and sent['revision'] == graded['revision'] + 1
assert student.request('GET', review_path)['document'] == document
expert.request('PUT', path + '/draft', {'expectedRevision': sent['revision'], 'document': document}, expected=409)
expert.request('POST', path + '/send', {'expectedRevision': sent['revision'], 'document': document}, expected=409)
assert restart()['review'] == document
assert db(f"SELECT md5(ai_document::text) FROM expert_works WHERE id={sql_literal(fixture['workId'])};", query=True) == ai_digest
assert db(source_digest_sql, query=True) == source_digest
assert db(f"SELECT count(*) FROM expert_review_versions WHERE work_id={sql_literal(fixture['workId'])} AND kind='final';", query=True) == '1'
assert expert.request('GET', path)['aiResult'] == original_ai

# Ordinary score edits stay stale; an explicit manual-grade accepts the current input.
manual_fixture = create_work('student', 'expert', fixtures['schoolId'])
manual_path = '/api/expert/works/' + manual_fixture['workId']
manual = expert.request('GET', manual_path)
manual_doc = copy.deepcopy(manual['review'])
manual_doc['origin'] = 'expert'
manual_doc['analysis']['summary'] += '\nЯвная ручная демонстрационная проверка'
manual_doc['grading'] = {'score': 0, 'criterion': 'Ручная демо-оценка', 'explanation': 'Это явное действие эксперта в локальном smoke'}
manual = expert.request('PUT', manual_path + '/draft', {'expectedRevision': manual['revision'], 'document': manual_doc})
assert manual['gradingStale'] is True
assert expert.request('POST', manual_path + '/send', {'expectedRevision': manual['revision'], 'document': manual_doc}, expected=409)['code'] == 'grading_stale'
manual_body = {'expectedRevision': manual['revision'], 'document': manual_doc}
expert.request('POST', manual_path + '/manual-grade', manual_body, expected=403, csrf=False)
other.request('POST', manual_path + '/manual-grade', manual_body, expected=404)
manual = expert.request('POST', manual_path + '/manual-grade', manual_body)
assert manual['gradingStale'] is False and manual['review'] == manual_doc and manual['gradeJob'] is None
manual = expert.request('POST', manual_path + '/send', {'expectedRevision': manual['revision'], 'document': manual_doc})
assert manual['status'] == 'sent' and manual['review']['grading']['score'] == 0
assert db(f"SELECT count(*) FROM expert_grading_jobs WHERE work_id={sql_literal(manual_fixture['workId'])};", query=True) == '0'
evidence = {'result': 'PASS', 'workId': fixture['workId'], 'submissionId': fixture['submissionId'], 'finalRevision': sent['revision'],
            'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'gradeJobId': job_id, 'manualWorkId': manual_fixture['workId'],
            'checks': ['login and expert role', 'school-scoped students and assignment', 'real local upload and mock AI', 'explicit learner routing',
                       'private media', 'cross-expert and cross-school denial', 'current school/membership/roster and reassignment revocation', 'CSRF', 'revision conflicts', 'draft learner privacy',
                       'independent OCR/analysis round-trip without automatic reset', 'stale grading blocks send', 'real mock stage-only grading and job recovery',
                       'grade idempotency and conflict', 'explicit manual grading without AI job', 'draft and final persisted across backend restart', 'immutable original AI', 'one immutable final version']}
(RUNTIME / 'smoke-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
(RUNTIME / 'smoke-evidence.json').chmod(0o600)
print('PASS: expert login → scoped assignment → real upload/mock AI → independent OCR/analysis → stale gate → grading-only mock job → final learner delivery; manual-grade, CSRF/ownership, idempotency/revision, immutable AI/final, two restarts.')
