#!/usr/bin/env python3
"""Post-seed HTTP checks only: no new submission, finalize, AI request or review edit."""
import datetime
import hashlib
import json
from common import RUNTIME, Client, assert_isolated, private_file


def no_private_fields(value):
    forbidden = {'referenceAnswer', 'referenceSolution', 'reference_answer', 'reference_solution',
                 'taskReference', 'objectKey', 'object_key', 'bucket', 'apiKey', 'exactResponse',
                 'exact_response', 'aiResult', 'ai_document', 'providerKey'}
    if isinstance(value, dict):
        if set(value) & forbidden:
            raise AssertionError('Private field in school response')
        for child in value.values():
            no_private_fields(child)
    elif isinstance(value, list):
        for child in value:
            no_private_fields(child)


def main():
    assert_isolated()
    fixtures = json.loads((RUNTIME / 'fixtures.json').read_text())
    receipt = json.loads((RUNTIME / 'asset-receipt.json').read_text())
    anonymous = Client()
    anonymous.request('GET', '/api/school/me', expected=401)
    student, expert = Client('student'), Client('expert')
    student.request('GET', '/api/expert/me', expected=403)
    student.request('GET', '/api/local-demo/runs', expected=403)
    identity = student.request('GET', '/api/school/me')
    if identity['id'] != fixtures['userIds']['student'] or identity['taskNumbers'] != [14, 15, 16, 17, 18, 19, 20]:
        raise AssertionError('School identity mismatch')
    expert_identity = expert.request('GET', '/api/expert/me')
    if expert_identity['id'] != fixtures['userIds']['expert'] or expert_identity['school']['id'] != fixtures['schoolId']:
        raise AssertionError('Assigned expert identity mismatch')
    expert.request('GET', '/api/local-demo/runs')
    student_list = expert.request('GET', '/api/expert/students?limit=50')
    if [item['id'] for item in student_list['items']] != [fixtures['userIds']['student']]:
        raise AssertionError('Unexpected expert roster')
    listing = student.request('GET', '/api/school/assignments?limit=50')
    page = listing
    while page.get('nextCursor'):
        page = student.request('GET', '/api/school/assignments?limit=50&cursor=' + str(page['nextCursor']))
        listing['items'].extend(page['items'])
    if {item['id'] for item in listing['items']} != {item['assignmentId'] for item in fixtures['assignments']}:
        raise AssertionError('Expected all prepared school assignments')
    no_private_fields(listing)
    checked = []
    for assignment in fixtures['assignments']:
        path = '/api/school/assignments/' + assignment['assignmentId']
        detail = student.request('GET', path)
        no_private_fields(detail)
        if detail['taskNumber'] != assignment['taskNumber'] or detail['task']['taskNumber'] != assignment['taskNumber']:
            raise AssertionError('Assignment/task mismatch')
        statement_id, reference_id = assignment['assetIds']['statement'], assignment['assetIds']['reference']
        media = path + '/task-media/' + statement_id
        image_blocks = [block for block in detail['task']['content'] if block['type'] == 'image']
        if not image_blocks or any(block['src'] != media for block in image_blocks):
            raise AssertionError('Task media was not projected for the current assignment')
        raw, headers = student.request('GET', media, raw=True)
        asset = next(item for item in receipt['assets'] if item['id'] == statement_id)
        if (hashlib.sha256(raw).hexdigest() != asset['sha256'] or not raw.startswith(b'\xff\xd8\xff')
                or 'image/jpeg' not in headers.get('Content-Type', '')
                or 'no-store' not in headers.get('Cache-Control', '')):
            raise AssertionError('Private statement media byte/header mismatch')
        student.request('GET', path + '/task-media/' + reference_id, expected=404)
        student.request('GET', '/api/media/' + reference_id, expected=404)
        expert.request('GET', path, expected=(403, 404))
        # Missing CSRF is rejected before a school submission can be created.
        student.request('POST', path + '/submissions', {}, expected=403,
                        headers={'Idempotency-Key': 'b2b-read-smoke-no-csrf'}, csrf=False)
        checked.append(assignment['assignmentId'])
    evidence = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'checks': ['school identity/roster', str(len(fixtures['assignments'])) + ' assignments', 'student JSON reference redaction',
                           'scoped statement JPEG bytes/no-store', 'reference media denial',
                           'role/operator isolation', 'missing-CSRF rejection'],
                'assignmentIds': checked, 'newSubmissions': 0, 'modelCalls': 0}
    path = RUNTIME / ('read-evidence-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    private_file(path, json.dumps(evidence, indent=2) + '\n')
    print('PASS: all prepared school assignments, scoped private statements, reference redaction, roles/operator/CSRF; no AI dispatch.')


if __name__ == '__main__':
    main()
