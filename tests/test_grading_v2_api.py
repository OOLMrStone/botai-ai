"""Offline local-v2 transport, artifact ownership, observability and resource limits."""
import asyncio
from copy import deepcopy
from io import BytesIO
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
import pytest

from app.api.routes_grading_v2 import (CONTRACT_VERSION, INTERNAL_PATH, MANUAL_BODY_BYTES,
                                      PREPARED_BODY_BYTES, GradingV2Middleware)
from app.core.errors import LLMResponseFormatError
from app.grading import v2_service
from app.grading.images import SafeImage
from app.grading.internal_contract import InternalGradingError
from app.grading.observability import MAX_ARTIFACT_BYTES, RunStore
from app.grading.package import MAX_SCORES
from app.grading.v2_artifacts import crop_diagram
from app.main import create_app

TOKEN = 'local-v2-test-token'
REAL_PREPARED = v2_service.run_prepared
REAL_MANUAL = v2_service.run_from_images


def photo():
    buffer = BytesIO()
    Image.new('RGB', (40, 30), 'white').save(buffer, 'PNG')
    return buffer.getvalue()


def payload(number=16, manual=False):
    common = {'contract_version': CONTRACT_VERSION, 'task_version_id': str(uuid4()),
              'solution_image_ids': [str(uuid4())]}
    if manual:
        return {**common, 'task_id': str(uuid4()), 'task_number': number, 'task_image_id': str(uuid4())}
    return {**common, 'task': {'id': str(uuid4()), 'task_number': number, 'max_score': MAX_SCORES[number],
                             'statement': 'x > 0', 'reference_answer': '(0; +∞)', 'reference_solution': None}}


def headers(run_id=None):
    return {'Authorization': 'Bearer ' + TOKEN, 'X-Request-ID': run_id or str(uuid4())}


def post(client, data=None, *, manual=False, request_headers=None, raw=None, image=None, extra=()):
    data = payload(manual=manual) if data is None else data
    parts = [('metadata', (None, raw if raw is not None else json.dumps(data, ensure_ascii=False), 'application/json'))]
    if manual:
        parts.append(('task_image', ('private-reference.png', photo(), 'image/png')))
    parts += [('solution_images', ('private-student.png', photo() if image is None else image, 'image/png'))
              for _ in data['solution_image_ids']]
    parts += list(extra)
    return client.post(INTERNAL_PATH + ('/from-images' if manual else ''), files=parts,
                       headers=headers() if request_headers is None else request_headers)


def result(task, image_ids, trace, images):
    metadata, data = crop_diagram(images[0], image_ids[0], {'x': 0, 'y': 0, 'width': 1, 'height': 1})
    trace.add_image(metadata, data)
    ocr = {'steps': [{'id': 's1', 'type': 'other', 'title': 'Решение', 'lines': ['x > 0'],
                      'figure': {'kind': 'image', 'artifact_id': metadata['id'], 'alt': 'Чертёж ученика'}}],
           'answer': '(0; +∞)'}
    trace.reader_ocr = deepcopy(ocr)
    trace.task_snapshot = deepcopy(task)
    return {'task': task, 'solution_image_ids': image_ids, 'is_graded': True, 'rejection_reason': '',
            'ocr': ocr, 'analysis': {'summary': 'Решение верно',
                'checks': {'domain': None, 'transformations': None,
                           'completeness': {'is_complete': True, 'reason': 'Все шаги записаны'}},
                'student_answer': {'text': '(0; +∞)', 'is_correct': True}, 'errors': [], 'strengths': [],
                'statuses': [{'id': 's1', 'status': 'ok', 'note': None, 'follows_from_step_ids': []}]},
            'grading': {'score': task['max_score'], 'criterion': 'Верное решение', 'explanation': 'Ответ получен верно'},
            'artifacts': [metadata]}


@pytest.fixture
def boundary(settings, tmp_path, monkeypatch):
    settings.internal_grading.enabled = False
    settings.internal_grading.token = SecretStr(TOKEN)
    settings.local_demo_ai.enabled = True
    settings.local_demo_ai.allow_live = False
    settings.photo.reports_dir = str(tmp_path / 'reports')
    calls = []

    def forbidden(*args, **kwargs):
        raise AssertionError('Paid provider construction is forbidden in offline tests')
    monkeypatch.setattr('app.grading.provider.Provider', forbidden)
    monkeypatch.setattr('app.grading.service.Provider', forbidden)
    monkeypatch.setattr('app.grading.v2_service.Provider', forbidden)

    async def prepared(current, task, image_ids, images, trace):
        calls.append(('prepared', deepcopy(task), list(image_ids), images, trace.run_id))
        with trace.stage('ocr'):
            call = {'call_id': str(uuid4()), 'operation': 'transcribe', 'attempt': 1,
                    'prompt': 'private prompt', 'api_key': 'secret-test-key', 'reasoning_content': 'private reasoning'}
            trace.emit('model_started', 'ocr', call)
            trace.emit('model_completed', 'ocr', {**call, 'duration_ms': 1})
        value = result(task, image_ids, trace, images)
        trace.add_json('ocr', value['ocr'])
        return json.dumps(value, ensure_ascii=False)

    async def manual(current, metadata, task_image, images, trace):
        calls.append(('manual', deepcopy(metadata), task_image))
        task = {'id': metadata['task_id'], 'task_number': metadata['task_number'],
                'max_score': MAX_SCORES[metadata['task_number']], 'statement': 'Прочитанное условие',
                'reference_answer': '(0; +∞)', 'reference_solution': None}
        with trace.stage('preparation'):
            trace.task_snapshot = deepcopy(task)
        return await prepared(current, task, metadata['solution_image_ids'], images, trace)

    monkeypatch.setattr(v2_service, 'run_prepared', prepared)
    monkeypatch.setattr(v2_service, 'run_from_images', manual)
    app = create_app(settings)
    with TestClient(app) as client:
        yield client, app, calls


def test_disabled_and_production_v2_routes_are_absent(settings, tmp_path):
    settings.photo.reports_dir = str(tmp_path / 'reports')
    for enabled, environment in ((False, 'local'), (True, 'prod')):
        settings.local_demo_ai.enabled = enabled
        settings.app.env = environment
        settings.internal_grading.enabled = False
        settings.internal_grading.token = None
        app = create_app(settings)
        assert not any(path.startswith(INTERNAL_PATH) for path in app.openapi()['paths'])
        with TestClient(app) as client:
            assert client.get(INTERNAL_PATH + '/capabilities').status_code == 404


def test_enabled_v2_requires_token_even_without_v1(settings):
    settings.internal_grading.enabled = False
    settings.local_demo_ai.enabled = True
    for token in (None, SecretStr(''), SecretStr('  ')):
        settings.internal_grading.token = token
        with pytest.raises(ValueError, match='INTERNAL_GRADING_TOKEN'):
            create_app(settings)


async def test_authentication_precedes_body_reads(settings):
    settings.internal_grading.token = SecretStr(TOKEN)
    sent = []
    async def forbidden(*args):
        raise AssertionError('Unauthorized request reached body parsing')
    async def send(message):
        sent.append(message)
    scope = {'type': 'http', 'path': INTERNAL_PATH, 'method': 'POST', 'headers': []}
    await GradingV2Middleware(forbidden, settings, RunStore())(scope, forbidden, send)
    assert sent[0]['status'] == 401


def test_capabilities_have_only_approved_tasks_without_dispatch(boundary):
    client, _, calls = boundary
    response = client.get(INTERNAL_PATH + '/capabilities', headers=headers())
    assert response.status_code == 200
    assert {item['task_number'] for item in response.json()['tasks'] if item['supported']} == {14, 16, 17, 18}
    assert response.json()['contract_version'] == CONTRACT_VERSION
    assert response.json()['input_modes'] == ['prepared', 'from-images']
    assert response.headers['x-grading-provider-mode'] == 'mock'
    assert not calls


def test_missing_package_is_not_advertised_as_supported(boundary, monkeypatch):
    client, _, calls = boundary
    original = __import__('app.api.routes_grading_v2', fromlist=['load_package']).load_package
    def missing(number):
        if number == 17:
            raise FileNotFoundError
        return original(number)
    monkeypatch.setattr('app.api.routes_grading_v2.load_package', missing)
    response = client.get(INTERNAL_PATH + '/capabilities', headers=headers())
    assert not next(item for item in response.json()['tasks'] if item['task_number'] == 17)['supported']
    assert post(client, payload(17)).json()['error']['code'] == 'unsupported_task'
    assert not calls


@pytest.mark.parametrize('manual', [False, True])
def test_success_exact_response_events_and_private_artifacts(boundary, manual):
    client, app, calls = boundary
    data, request_headers = payload(manual=manual), headers()
    response = post(client, data, manual=manual, request_headers=request_headers)
    assert response.status_code == 200, response.text
    value = response.json()
    assert value['is_graded'] and value['solution_image_ids'] == data['solution_image_ids']
    assert response.headers['x-grading-contract-version'] == CONTRACT_VERSION
    assert response.headers['x-grading-package-id'].startswith('sha256:')
    assert response.headers['x-request-id'] == request_headers['X-Request-ID']
    assert response.headers['cache-control'] == 'no-store' and 'set-cookie' not in response.headers
    if manual:
        assert value['task']['id'] == data['task_id'] and value['task']['statement'] == 'Прочитанное условие'
    else:
        assert value['task'] == data['task']
    prepared_call = next(item for item in calls if item[0] == 'prepared')
    assert all(isinstance(image, SafeImage) and image.media_type == 'image/jpeg' for image in prepared_call[3])
    run_id = request_headers['X-Request-ID']
    url = INTERNAL_PATH + '/runs/' + run_id
    first = client.get(url + '/events?limit=2', headers=headers()).json()
    assert len(first['items']) == 2 and first['next_after'] == 2 and first['has_more']
    page = client.get(url + '/events?after=2', headers=headers()).json()
    events = first['items'] + page['items']
    assert [event['seq'] for event in events] == list(range(1, len(events) + 1))
    assert all(event['run_id'] == run_id and event['created_at'].endswith('Z') for event in events)
    assert events[-1]['type'] == 'completed'
    encoded = json.dumps(events)
    assert all(text not in encoded for text in ('private prompt', 'secret-test-key', 'private reasoning'))
    assert any(event['type'] == 'model_completed' and event['data']['duration_ms'] == 1 for event in events)
    final_id = events[-1]['data']['artifact_id']
    saved = client.get(url + '/artifacts/' + final_id, headers=headers())
    assert saved.json() == value
    metadata = value['artifacts'][0]
    artifact_url = url + '/artifacts/' + metadata['id']
    image = client.get(artifact_url, headers=headers())
    assert image.status_code == 200 and len(image.content) == metadata['byte_size']
    assert image.headers['content-type'] == 'image/jpeg'
    assert client.get(artifact_url).status_code == 401
    assert client.get(url + '/events').status_code == 401
    assert app.state.photo_active == 0


def test_duplicate_uuid_never_dispatches_twice(boundary):
    client, _, calls = boundary
    request_headers = headers()
    assert post(client, request_headers=request_headers).status_code == 200
    response = post(client, request_headers=request_headers)
    assert response.status_code == 409 and response.json()['error']['code'] == 'duplicate_run'
    assert len(calls) == 1


def test_artifact_cannot_be_read_through_another_run(boundary):
    client, _, _ = boundary
    first_headers, second_headers = headers(), headers()
    first = post(client, request_headers=first_headers).json()
    assert post(client, request_headers=second_headers).status_code == 200
    url = INTERNAL_PATH + '/runs/' + second_headers['X-Request-ID'] + '/artifacts/' + first['artifacts'][0]['id']
    assert client.get(url, headers=headers()).status_code == 404


@pytest.mark.parametrize('mutate', [
    lambda value: value.update(contract_version='photo-grade.v1'),
    lambda value: value.update(task_version_id='not-a-uuid'),
    lambda value: value['task'].update(task_number=True),
    lambda value: value['task'].update(max_score=99),
    lambda value: value['task'].update(statement='\ud800'),
    lambda value: value['task'].update(task_number=15, max_score=3),
    lambda value: value['solution_image_ids'].append(value['solution_image_ids'][0]),
])
def test_invalid_prepared_metadata_never_dispatches(boundary, mutate):
    client, _, calls = boundary
    value = payload()
    mutate(value)
    response = post(client, value, raw=json.dumps(value))
    assert response.status_code == 422
    assert not calls


def test_invalid_manual_ids_and_bad_images_never_dispatch(boundary):
    client, _, calls = boundary
    data = payload(manual=True)
    data['task_image_id'] = data['solution_image_ids'][0]
    assert post(client, data, manual=True).status_code == 422
    assert post(client, image=b'not an image').status_code == 422
    assert post(client, raw='{"contract_version":"photo-grade.v2","contract_version":"photo-grade.v1"}').status_code == 422
    assert not calls


def test_invalid_request_id_and_extra_parts_never_dispatch(boundary):
    client, _, calls = boundary
    assert post(client, request_headers={**headers(), 'X-Request-ID': 'private text'}).status_code == 422
    assert post(client, extra=[('extra', (None, 'value'))]).status_code == 422
    assert not calls


def test_live_provider_requires_server_gate(boundary):
    client, app, calls = boundary
    app.state.settings.llm.provider = 'openai'
    response = post(client)
    assert response.status_code == 503 and response.json()['error']['code'] == 'live_provider_disabled'
    assert response.headers['x-grading-provider-mode'] == 'live'
    assert not calls


def test_invalid_pipeline_output_cannot_be_success(boundary, monkeypatch):
    client, app, _ = boundary
    async def malformed(*args):
        return '{"grading":{"score":2}}'
    monkeypatch.setattr(v2_service, 'run_prepared', malformed)
    request_headers = headers()
    response = post(client, request_headers=request_headers)
    assert response.status_code == 502 and response.json()['error']['code'] == 'llm_bad_response'
    events = app.state.grading_v2_store.events(request_headers['X-Request-ID'])['items']
    assert events[-1]['type'] == 'failed' and not any(event['type'] == 'completed' for event in events)
    assert 'grading' not in response.json() and app.state.photo_active == 0


def test_timeout_releases_shared_slot_and_records_failure(boundary, monkeypatch):
    client, app, _ = boundary
    async def blocked(*args):
        await asyncio.Event().wait()
    monkeypatch.setattr(v2_service, 'run_prepared', blocked)
    app.state.settings.photo.deadline_seconds = .05
    request_headers = headers()
    response = post(client, request_headers=request_headers)
    assert response.status_code == 504, response.text
    assert app.state.photo_active == 0
    events = app.state.grading_v2_store.events(request_headers['X-Request-ID'])['items']
    assert events[-1]['type'] == 'failed' and events[-1]['data']['code'] == 'llm_timeout'


def test_busy_uses_shared_concurrency_before_dispatch(boundary):
    client, app, calls = boundary
    app.state.photo_active = app.state.settings.photo.concurrency
    assert post(client).status_code == 429
    assert not calls


@pytest.mark.parametrize('manual', [False, True])
async def test_streaming_body_bound_without_content_length(settings, monkeypatch, manual):
    import app.api.routes_grading_v2 as routes
    assert PREPARED_BODY_BYTES == 33 * 1024 * 1024 and MANUAL_BODY_BYTES == 41 * 1024 * 1024
    monkeypatch.setattr(routes, 'MANUAL_BODY_BYTES' if manual else 'PREPARED_BODY_BYTES', 10)
    settings.internal_grading.token = SecretStr(TOKEN)
    sent = []
    async def consume(scope, receive, send):
        await receive()
    async def receive():
        return {'type': 'http.request', 'body': b'x' * 11, 'more_body': False}
    async def send(message):
        sent.append(message)
    scope = {'type': 'http', 'path': INTERNAL_PATH + ('/from-images' if manual else ''),
             'method': 'POST', 'headers': [(key.lower().encode(), value.encode()) for key, value in headers().items()]}
    await GradingV2Middleware(consume, settings, RunStore())(scope, receive, send)
    assert sent[0]['status'] == 413


def test_store_ttl_run_limit_artifact_bytes_and_redaction():
    now = [0.0]
    store = RunStore(clock=lambda: now[0], ttl_seconds=30, max_runs=1)
    run_id = str(uuid4())
    trace = store.start(run_id, provider_mode='mock')
    trace.emit('validation_failed', 'validation', {'issue_paths': ['$.ocr.steps[0]', 'private prompt'],
               'issue_codes': ['invalid_type', 'private instruction'], 'reasoning_content': 'private reasoning'})
    event = store.events(run_id)['items'][-1]
    assert event['data'] == {'issue_paths': ['$.ocr.steps[0]'], 'issue_codes': ['invalid_type']}
    with pytest.raises(InternalGradingError, match='заполнено'):
        store.start(str(uuid4()), provider_mode='mock')
    with pytest.raises(InternalGradingError, match='1 МиБ'):
        trace.add_json('grading', {'score': 1, 'criterion': 'x', 'explanation': 'x' * MAX_ARTIFACT_BYTES})
    with pytest.raises(ValueError):
        trace.add_json('grading', {'score': 1, 'criterion': 'x', 'explanation': {'api_key': 'secret'}})
    now[0] = 31
    with pytest.raises(InternalGradingError) as missing:
        store.events(run_id)
    assert missing.value.status_code == 404
    store.start(str(uuid4()), provider_mode='mock')


def test_store_total_bytes_and_diagram_count_are_bounded():
    store = RunStore(max_bytes=1000)
    trace = store.start(str(uuid4()), provider_mode='mock')
    with pytest.raises(InternalGradingError) as full:
        trace.add_json('grading', {'score': 1, 'criterion': 'x', 'explanation': 'x' * 900})
    assert full.value.code == 'run_store_full'
    store = RunStore()
    trace = store.start(str(uuid4()), provider_mode='mock')
    source = str(uuid4())
    trace.solution_image_ids = [source]
    for _ in range(8):
        metadata, data = crop_diagram(SafeImage(photo(), 'image/png'), source, {'x': 0, 'y': 0, 'width': 1, 'height': 1})
        trace.add_image(metadata, data)
    metadata, data = crop_diagram(SafeImage(photo(), 'image/png'), source, {'x': 0, 'y': 0, 'width': 1, 'height': 1})
    with pytest.raises(InternalGradingError) as full:
        trace.add_image(metadata, data)
    assert full.value.code == 'artifact_limit_exceeded'


@pytest.mark.parametrize('manual', [False, True])
def test_real_v2_pipeline_mock_has_actual_stage_and_call_events(boundary, monkeypatch, manual):
    client, app, _ = boundary
    monkeypatch.setattr(v2_service, 'run_prepared', REAL_PREPARED)
    monkeypatch.setattr(v2_service, 'run_from_images', REAL_MANUAL)
    request_headers = headers()
    response = post(client, manual=manual, request_headers=request_headers)
    assert response.status_code == 200, response.text
    assert response.json()['is_graded'] and type(response.json()['ocr']) is dict
    events = app.state.grading_v2_store.events(request_headers['X-Request-ID'])['items']
    stages = {event['phase'] for event in events if event['type'] == 'stage_completed'}
    assert {'ocr', 'layout', 'analysis', 'grading', 'validation'} <= stages
    assert ('preparation' in stages) is manual
    starts = [event['data']['call_id'] for event in events if event['type'] == 'model_started']
    ends = [event['data']['call_id'] for event in events if event['type'] == 'model_completed']
    assert len(starts) >= 7 and starts == ends
    assert events[-1]['type'] == 'completed'


def test_actual_multipart_stream_failure_remains_413(boundary, monkeypatch):
    client, _, calls = boundary
    monkeypatch.setattr('app.api.routes_grading_v2.PREPARED_BODY_BYTES', 10)
    response = client.post(INTERNAL_PATH,
        headers={**headers(), 'Content-Type': 'multipart/form-data; boundary=bound'},
        content=iter([b'--bound\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{}\r\n--bound--']))
    assert response.status_code == 413, response.text
    assert not calls


def test_reference_or_unrelated_images_cannot_be_stored_as_student_artifacts():
    trace = RunStore().start(str(uuid4()), provider_mode='mock')
    trace.solution_image_ids = [str(uuid4())]
    metadata, data = crop_diagram(SafeImage(photo(), 'image/png'), str(uuid4()),
                                  {'x': 0, 'y': 0, 'width': 1, 'height': 1})
    with pytest.raises(ValueError, match='metadata'):
        trace.add_image(metadata, data)
    assert trace.diagram_metadata == []


@pytest.mark.parametrize('query', ['after=-1', 'limit=0', 'limit=101', 'after=x', 'after=0&after=1', 'token=secret'])
def test_invalid_event_cursors_are_controlled(boundary, query):
    client, _, _ = boundary
    request_headers = headers()
    assert post(client, request_headers=request_headers).status_code == 200
    response = client.get(INTERNAL_PATH + '/runs/' + request_headers['X-Request-ID'] + '/events?' + query,
                          headers=headers())
    assert response.status_code == 422 and response.json()['error']['code'] == 'invalid_cursor'
