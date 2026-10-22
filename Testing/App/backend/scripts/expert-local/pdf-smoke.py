#!/usr/bin/env python3
"""Exercise isolated private PDF upload/raster/original flow using synthetic fixtures."""
import datetime
import hashlib
import json
import subprocess
import time
import uuid
from common import Client, COMPOSE, ROOT, RUNTIME, db, sql_literal

fixtures = json.loads((RUNTIME / 'fixtures.json').read_text())
qa = ROOT / 'renderer/pdf/build/qa'
original = (qa / 'passive-two-pages.pdf').read_bytes()
owner, expert, other, same, foreign = [Client(name) for name in ('student', 'expert', 'other_expert', 'same_school_expert', 'other_student')]

def draft():
    attempt = owner.request('POST', '/api/training-attempts', {'formatId': 'ege-profile-20-v1', 'selections': [{'examNumber': 16, 'count': 1}]}, headers={'Idempotency-Key': str(uuid.uuid4())})
    item = attempt['items'][0]
    submission = owner.request('POST', '/api/submissions', {'attemptId': attempt['id'], 'attemptItemId': item['id'], 'inputRevision': item['answerRevision']}, headers={'Idempotency-Key': str(uuid.uuid4())})
    return attempt['id'], submission['id']

def multipart(data, name, mime):
    boundary = 'expert-pdf-' + uuid.uuid4().hex
    return (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + f'\r\n--{boundary}--\r\n'.encode(), {'Content-Type': 'multipart/form-data; boundary=' + boundary})

def upload(submission, data=original, csrf=True, expected=202, actor=owner):
    body, headers = multipart(data, 'synthetic-solution.pdf', 'application/pdf')
    return actor.request('POST', f'/api/submissions/{submission}/documents', body, expected=expected, headers=headers, csrf=csrf)

def wait_document(submission, document, state):
    for _ in range(100):
        value = owner.request('GET', '/api/submissions/' + submission)
        found = next(item for item in value['documents'] if item['id'] == document)
        if found['state'] != 'processing':
            assert found['state'] == state, 'Unexpected PDF outcome: ' + str(found.get('errorCode'))
            return value, found
        time.sleep(.5)
    raise AssertionError('PDF processing did not finish')

def private_download(actor, url):
    data, headers = actor.request('GET', url, raw=True)
    headers = {key.lower(): value for key, value in headers.items()}
    assert data == original
    assert headers['content-type'].split(';')[0] == 'application/pdf'
    assert 'attachment' in headers['content-disposition'].lower()
    assert 'private' in headers['cache-control'] and 'no-store' in headers['cache-control']
    assert headers['x-content-type-options'] == 'nosniff' and 'sandbox' in headers['content-security-policy']
    return hashlib.sha256(data).hexdigest()

attempt, submission = draft()
upload(submission, csrf=False, expected=403)
upload(submission, expected=404, actor=foreign)
document = upload(submission)
assert document['state'] == 'processing' and document['pages'] == []
current = owner.request('GET', '/api/submissions/' + submission)
if any(item['state'] == 'processing' for item in current['documents']):
    assert owner.request('POST', f'/api/submissions/{submission}/finalize', {'expectedRevision': current['revision']}, expected=409)['code'] == 'uploads_in_flight'
current, ready = wait_document(submission, document['id'], 'ready')
assert ready['pageCount'] == 2 and len(ready['pages']) == 2
assert [page['pageNumber'] for page in ready['pages']] == [1, 2]
assert len(current['images']) == 2
assert {page['id'] for page in ready['pages']} == {page['id'] for page in current['images']}
assert all(page['mimeType'] == 'image/jpeg' and page['sourceDocumentId'] == document['id'] for page in ready['pages'])
assert private_download(owner, ready['downloadUrl']) == ready['sha256']
foreign.request('GET', ready['downloadUrl'], expected=404)
Client(login=False).request('GET', ready['downloadUrl'], expected=401)
for page in ready['pages']:
    data, headers = owner.request('GET', page['previewUrl'], raw=True)
    assert data.startswith(b'\xff\xd8')
    digest = db(f"SELECT sha256 FROM stored_objects WHERE id={sql_literal(page['id'])};", query=True)
    assert hashlib.sha256(data).hexdigest() == digest

owner.request('POST', f'/api/submissions/{submission}/finalize', {'expectedRevision': current['revision']})
for _ in range(100):
    current = owner.request('GET', '/api/submissions/' + submission)
    if current['status'] not in ('queued', 'running'):
        break
    time.sleep(.5)
assert current['status'] == 'graded' and current['result']['isDemo']
work = owner.request('POST', f'/api/submissions/{submission}/expert-review', {'schoolId': fixtures['schoolId']})
work_path = '/api/expert/works/' + work['id']
work = expert.request('GET', work_path)
assert len(work['documents']) == 1 and len(work['images']) == 2
pdf = work['documents'][0]
assert pdf['id'] == document['id'] and private_download(expert, pdf['downloadUrl']) == ready['sha256']
for actor in (other, same):
    actor.request('GET', pdf['downloadUrl'], expected=404)
    for page in work['images']:
        actor.request('GET', page['previewUrl'], expected=404)
assert set(work['aiResult']['solution_image_ids']) == {image['id'] for image in work['images']}
assert document['id'] not in json.dumps(work['aiResult'])
assert db(f"SELECT count(*) FROM stored_objects WHERE submission_id={sql_literal(submission)} AND state='ready' AND mime_type<>'image/jpeg';", query=True) == '0'

# Failed conversions release every reservation and clean original/planned objects.
failed_ids = []
for name, code in [('encrypted-empty-password.pdf', 'pdf_encrypted'), ('unsafe-javascript.pdf', 'pdf_active_content')]:
    _, rejected_submission = draft()
    rejected = upload(rejected_submission, (qa / name).read_bytes())
    failed, rejection = wait_document(rejected_submission, rejected['id'], 'failed')
    assert rejection['errorCode'] == code and failed['images'] == []
    assert owner.request('POST', f'/api/submissions/{rejected_submission}/finalize', {'expectedRevision': failed['revision']}, expected=409)['code'] == 'pdf_failed'
    failed_ids.append(rejected['id'])
    for _ in range(60):
        clean = db(f"SELECT cleanup_complete::text FROM solution_documents WHERE id={sql_literal(rejected['id'])};", query=True)
        if clean == 'true': break
        time.sleep(.5)
    assert clean == 'true'
    assert db(f"SELECT count(*) FROM stored_objects WHERE source_document_id={sql_literal(rejected['id'])} AND state IN('staged','ready');", query=True) == '0'

# A two-page file must not be silently truncated to one remaining slot.
_, budget_submission = draft()
asset = (ROOT.parent / 'botai-front/public/tasks/mock-exam/task-11-graph.png').read_bytes()
for _ in range(3):
    body, headers = multipart(asset, 'synthetic-graph.png', 'image/png')
    owner.request('POST', f'/api/submissions/{budget_submission}/images', body, headers=headers)
budget_pdf = upload(budget_submission)
budget, rejected = wait_document(budget_submission, budget_pdf['id'], 'failed')
assert rejected['errorCode'] == 'pdf_page_budget' and len(budget['images']) == 3

# The next good PDF still works; deleting one derived page deletes its whole group.
_, group_submission = draft()
group_pdf = upload(group_submission)
group, group_pdf = wait_document(group_submission, group_pdf['id'], 'ready')
owner.request('DELETE', f'/api/submissions/{group_submission}/images/{group_pdf["pages"][0]["id"]}', expected=200)
group = owner.request('GET', '/api/submissions/' + group_submission)
assert group['images'] == [] and group['documents'] == []
owner.request('GET', group_pdf['downloadUrl'], expected=404)

subprocess.run([COMPOSE, 'restart', 'backend'], stdout=subprocess.DEVNULL, check=True)
for _ in range(90):
    try:
        expert = Client('expert'); persisted = expert.request('GET', work_path)
        break
    except Exception:
        time.sleep(1)
else: raise AssertionError('Backend restart timeout')
assert private_download(expert, persisted['documents'][0]['downloadUrl']) == ready['sha256']
assert persisted['aiResult'] == work['aiResult']
evidence = {'result': 'PASS', 'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'workId': work['id'], 'submissionId': submission,
    'attemptId': attempt, 'documentId': document['id'], 'originalSha256': ready['sha256'], 'pageIds': [page['id'] for page in ready['pages']],
    'failedDocumentIds': failed_ids, 'budgetDocumentId': budget_pdf['id'], 'deletedDocumentId': group_pdf['id'],
    'checks': ['real raw PDF/private original + raster flow', 'ordered page mapping and cleaned SHA', 'mock AI uses JPEG IDs only', 'scoped owner/expert originals and page media',
        'CSRF/foreign denial', 'processing finalize gate', 'encrypted empty-password/active-content reject and cleanup', 'remaining-page budget no truncation',
        'next good conversion after rejection', 'derived-image deletion removes whole document group', 'restart preserves immutable original and AI']}
path = RUNTIME / 'pdf-smoke-evidence.json'; path.write_text(json.dumps(evidence, indent=2) + '\n'); path.chmod(0o600)
print('PASS: private PDF original → ordered JPEG pages → real mock AI → scoped expert original; failure cleanup/budget/group deletion/restart.')
