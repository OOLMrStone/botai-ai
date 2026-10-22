#!/usr/bin/env python3
"""Exercise the real local HTTP workflow with an explicitly verified mock provider."""
import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
import urllib.parse
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--backend', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.backend / 'scripts/b2b-local'))
from common import Client, RUNTIME, COMPOSE
from provenance import verify_proof, running_ids, write_state

proof = verify_proof(json.loads((RUNTIME / 'build-proof.json').read_text()))
assert running_ids() == proof['images'], 'Running images do not match this mock build'
# Inspect in memory; never print the environment (a live environment could contain a key).
for service in ('ai', 'backend'):
    container = subprocess.check_output([str(COMPOSE), 'ps', '-q', service], text=True).strip()
    info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
    env = dict(value.split('=', 1) for value in info['Config']['Env'])
    required = ({'LLM_PROVIDER': 'mock', 'LLM_VISION_PROVIDER': 'mock', 'LOCAL_DEMO_AI_ALLOW_LIVE': 'false'}
                if service == 'ai' else {'APP_B2B_ALLOW_LIVE': 'false', 'APP_EXPERT_GRADING_ALLOW_LIVE': 'false'})
    assert all(env.get(k) == v for k, v in required.items()), 'Refusing to submit to non-mock services'

student, expert = Client('student'), Client('expert')
fixtures = json.loads((RUNTIME / 'fixtures.json').read_text())
assignment = next(a for a in fixtures['assignments'] if a['caseId'] == 'fipi-13.3.2')
base = '/api/school/assignments/' + assignment['assignmentId']
receipt_path = RUNTIME / 'partner-mock-verification.json'
# Hold an OS-released lock through dispatch and receipt updates. A second verifier
# must not create another submission while the first process is still running.
lock_fd = os.open(RUNTIME / '.partner-mock-verification.lock',
                  os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('Another mock verification is running; wait for it to finish.')


def saved_result(saved):
    submission = student.request('GET', '/api/submissions/' + saved['submissionId'])
    assert submission['status'] == 'returned' and submission.get('result') is not None, \
        'Saved verification result is not returned; no new submission was created'
    return submission


def assert_new_submission_allowed():
    detail = student.request('GET', base)
    assert detail.get('canResubmit'), 'Assignment cannot accept a new verification'
    # Pending expert work also counts as unfinished, even if AI already completed.
    assert all(item['status'] == 'returned' and not item.get('errorCode')
               for item in detail.get('history', [])), \
        'Existing unfinished/failed/unknown work preserved; inspect it before verifying'


def find_submission(client, path, submission_id):
    cursor = None
    seen = set()
    while True:
        query = {'limit': 50}
        if cursor is not None:
            query['cursor'] = cursor
        page = client.request('GET', path + '?' + urllib.parse.urlencode(query))
        item = next((item for item in page['items'] if item['submissionId'] == submission_id), None)
        if item is not None:
            return item
        cursor = page.get('nextCursor')
        if cursor is None:
            return None
        assert cursor not in seen, 'API returned a repeating pagination cursor'
        seen.add(cursor)


receipt = None
if receipt_path.exists():
    assert not receipt_path.is_symlink(), 'Private receipt symlinks are forbidden'
    receipt = json.loads(receipt_path.read_text())
    assert receipt.get('assignmentId') == assignment['assignmentId'], 'Receipt assignment differs'
    if receipt.get('images') == proof['images']:
        if receipt.get('passed'):
            saved_result(receipt)
            print('PASS: previous mock flow receipt matches running images; student result remains available.')
            raise SystemExit(0)
        # Resume the same request after an interrupted create, upload, queue,
        # expert save/send, or receipt update. Never replace unfinished work.
        assert receipt.get('submissionId') or receipt.get('idempotencyKey'), 'Incomplete receipt has no recovery key'
    else:
        assert receipt.get('passed'), 'Incomplete receipt belongs to another build; preserved for inspection'
        saved_result(receipt)
        assert_new_submission_allowed()
        history = RUNTIME / 'verification-history'
        assert not history.is_symlink(), 'Private history symlinks are forbidden'
        history.mkdir(exist_ok=True, mode=0o700)
        archived = history / ('partner-mock-' + str(uuid.uuid4()) + '.json')
        write_state(archived, receipt)
        receipt = None

if receipt is None:
    assert_new_submission_allowed()
    receipt = {'passed': False, 'images': proof['images'],
               'assignmentId': assignment['assignmentId'],
               'idempotencyKey': 'partner-smoke-' + str(uuid.uuid4())}
    # Store the idempotency key before POST: a lost response can be replayed
    # without creating an untracked second submission.
    write_state(receipt_path, receipt)

if not receipt.get('submissionId'):
    created = student.request('POST', base + '/submissions', {}, expected=(200, 201),
                              headers={'Idempotency-Key': receipt['idempotencyKey']})
    receipt['submissionId'] = created['id']
    write_state(receipt_path, receipt)
sid = receipt['submissionId']
draft = student.request('GET', '/api/submissions/' + sid)
assert not draft.get('errorCode'), 'Submission has an error; preserved without redispatch'
if draft['status'] == 'draft':
    detail = student.request('GET', base)
    assert detail['submissionId'] == sid, 'Verification draft is no longer the current assignment attempt'
    assert not detail.get('fixtureAttachmentIncomplete'), 'Fixture attachment is incomplete; inspect before retrying'
    if not draft['images']:
        student.request('POST', base + '/submissions/' + sid + '/fixture', {})
    draft = student.request('GET', '/api/submissions/' + sid)
    assert draft['images'], 'Fixture did not attach the source solution'
    student.request('POST', '/api/submissions/' + sid + '/finalize', {'expectedRevision': draft['revision']})

work = None
until = time.monotonic() + 180
while time.monotonic() < until:
    detail = student.request('GET', '/api/submissions/' + sid)
    if detail.get('errorCode') or detail['status'] in ('failed', 'cancelled', 'expired', 'rejected'):
        raise SystemExit('Mock grading failed; inspect developer console and backend logs.')
    work = find_submission(expert, '/api/expert/works', sid)
    if work:
        break
    time.sleep(1)
assert work, 'Mock grading did not reach the expert within 180 seconds'
work_path = '/api/expert/works/' + work['id']
work = expert.request('GET', work_path)
assert work['isDemo'] and work['review']['phase'] == 'graded'
# Save through the real revision-checked expert API, then confirm the mock review.
if work['status'] != 'sent':
    document = dict(work['review'], origin='expert')
    work = expert.request('PUT', work_path + '/draft',
                          {'expectedRevision': work['revision'], 'document': document})
    work = expert.request('POST', work_path + '/send',
                          {'expectedRevision': work['revision'], 'document': work['review']})
assert work['status'] == 'sent'
saved_result(receipt)
result = student.request('GET', base + '/result')
assert result['submissionId'] == sid and result['status'] == 'returned' and result['result'] is not None
run = find_submission(expert, '/api/local-demo/runs', sid)
assert run, 'Verification run missing from developer console'
run = expert.request('GET', '/api/local-demo/runs/' + run['id'])
assert run['aiResult'] is not None
receipt.update(passed=True, workId=work['id'], runId=run['id'])
write_state(receipt_path, receipt)
print('PASS: student attachment → mock AI → expert draft → confirmation → student result; developer run available.')
