#!/usr/bin/env python3
"""Exercise the real local HTTP workflow with an explicitly verified mock provider."""
import argparse
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--backend', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.backend / 'scripts/b2b-local'))
from common import Client, RUNTIME, COMPOSE, private_file
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
if receipt_path.exists():
    receipt = json.loads(receipt_path.read_text())
    if receipt.get('passed') and receipt.get('images') == proof['images']:
        assert student.request('GET', base + '/result')['status'] == 'returned'
        print('PASS: previous mock flow receipt matches running images; student result remains available.')
        raise SystemExit(0)
    raise SystemExit('An earlier verification receipt exists; inspect it before starting another submission.')

created = student.request('POST', base + '/submissions', {}, expected=201,
                          headers={'Idempotency-Key': 'partner-smoke-' + str(uuid.uuid4())})
sid = created['id']
receipt = {'passed': False, 'images': proof['images'], 'submissionId': sid,
           'assignmentId': assignment['assignmentId']}
private_file(receipt_path, json.dumps(receipt, indent=2) + '\n')
student.request('POST', base + '/submissions/' + sid + '/fixture', {})
draft = student.request('GET', '/api/submissions/' + sid)
assert draft['images'], 'Fixture did not attach the source solution'
student.request('POST', '/api/submissions/' + sid + '/finalize', {'expectedRevision': draft['revision']})

work = None
until = time.monotonic() + 180
while time.monotonic() < until:
    detail = student.request('GET', base)
    if detail['status'] in ('failed', 'cancelled', 'expired'):
        raise SystemExit('Mock grading failed; inspect developer console and backend logs.')
    works = expert.request('GET', '/api/expert/works?limit=100')['items']
    work = next((w for w in works if w['submissionId'] == sid), None)
    if work:
        break
    time.sleep(1)
assert work, 'Mock grading did not reach the expert within 180 seconds'
work_path = '/api/expert/works/' + work['id']
work = expert.request('GET', work_path)
assert work['isDemo'] and work['review']['phase'] == 'graded'
# Save through the real revision-checked expert API, then confirm the mock review.
work = expert.request('PUT', work_path + '/draft',
                      {'expectedRevision': work['revision'], 'document': work['review']})
work = expert.request('POST', work_path + '/send',
                      {'expectedRevision': work['revision'], 'document': work['review']})
assert work['status'] == 'sent'
result = student.request('GET', base + '/result')
assert result['status'] == 'returned' and result['result'] is not None
runs = expert.request('GET', '/api/local-demo/runs?limit=100')['items']
run = next(r for r in runs if r['submissionId'] == sid)
run = expert.request('GET', '/api/local-demo/runs/' + run['id'])
assert run['aiResult'] is not None
receipt.update(passed=True, workId=work['id'], runId=run['id'])
write_state(receipt_path, receipt)
print('PASS: student attachment → mock AI → expert draft → confirmation → student result; developer run available.')
