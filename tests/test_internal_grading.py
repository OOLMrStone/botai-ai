"""Offline service boundary, provenance and approved-pipeline regression."""
import asyncio
from copy import deepcopy
from dataclasses import replace
from io import BytesIO
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
import pytest

from app.api.routes_internal_grading import InternalGradingMiddleware
from app.core.errors import LLMError
from app.grading.capabilities import MAX_SCORES, build_registry, package_digest
from app.grading.internal_contract import CONTRACT_VERSION, INTERNAL_PATH, MAX_BODY_BYTES
from app.grading.provider import MockProvider
from app.grading.session import ATTACK_REASON, READ_ORDER
from app.main import create_app

TOKEN = 'internal-test-token-not-a-user-credential'


def payload(number=16, count=1):
    return {'contract_version': CONTRACT_VERSION, 'task_version_id': str(uuid4()),
            'task': {'id': str(uuid4()), 'task_number': number, 'max_score': MAX_SCORES[number],
                     'statement': 'Решите x > 2', 'reference_answer': '(2; +∞)',
                     'reference_solution': None},
            'solution_image_ids': [str(uuid4()) for _ in range(count)]}


def photo():
    buffer = BytesIO()
    Image.new('RGB', (30, 20), 'white').save(buffer, 'PNG')
    return buffer.getvalue()


def headers():
    return {'Authorization': 'Bearer ' + TOKEN, 'X-Request-ID': str(uuid4())}


def post(client, value=None, *, raw=None, image=None, count=None, request_headers=None):
    value = payload() if value is None else value
    count = len(value['solution_image_ids']) if count is None else count
    parts = [('metadata', (None, raw if raw is not None else json.dumps(value, ensure_ascii=False), 'application/json'))]
    parts += [('solution_images', ('private-filename.png', photo() if image is None else image, 'image/png')) for _ in range(count)]
    return client.post(INTERNAL_PATH, files=parts, headers=headers() if request_headers is None else request_headers)


def assert_provenance(response, *, selected=False, mode='mock'):
    assert response.headers['x-grading-contract-version'] == CONTRACT_VERSION
    assert response.headers['x-grading-provider-mode'] == mode
    assert response.headers['x-grading-package-id'].startswith('sha256:') if selected else response.headers['x-grading-package-id'] == 'none'
    assert response.headers['cache-control'] == 'no-store'
    assert len(response.headers['x-request-id']) == 36
    assert 'set-cookie' not in response.headers


class RecordingProvider(MockProvider):
    def __init__(self):
        self.inputs = []
        self.closed = False
        self.last_raw = None

    async def chat(self, messages, tools=None):
        self.inputs.append((deepcopy(messages), tools))
        result = await super().chat(messages, tools)
        if not result.get('tool_calls'):
            self.last_raw = result['content']
        return result

    async def close(self):
        self.closed = True


@pytest.fixture
def internal(settings, tmp_path, monkeypatch):
    settings.internal_grading.enabled = True
    settings.internal_grading.token = SecretStr(TOKEN)
    settings.photo.reports_dir = str(tmp_path / 'standalone')
    providers = []

    def factory():
        provider = RecordingProvider()
        providers.append(provider)
        return provider

    def paid_calls_forbidden(*args, **kwargs):
        raise AssertionError('No live provider is allowed in offline tests')

    monkeypatch.setattr('app.grading.service.MockProvider', factory)
    monkeypatch.setattr('app.grading.service.Provider', paid_calls_forbidden)
    app = create_app(settings)
    with TestClient(app) as client:
        yield client, app, providers


def test_disabled_route_and_fail_closed_configuration(settings):
    settings.internal_grading.enabled = False
    with TestClient(create_app(settings)) as client:
        assert client.get(INTERNAL_PATH + '/capabilities').status_code == 404
    settings.internal_grading.enabled = True
    for token in (None, SecretStr(''), SecretStr('   ')):
        settings.internal_grading.token = token
        with pytest.raises(ValueError, match='INTERNAL_GRADING_TOKEN'):
            create_app(settings)


def test_config_never_discloses_service_secret(settings):
    settings.internal_grading.token = SecretStr(TOKEN)
    assert TOKEN not in json.dumps(settings.redacted())
    assert TOKEN not in repr(settings)


async def test_unauthorized_body_is_never_read(settings):
    settings.internal_grading.enabled = True
    settings.internal_grading.token = SecretStr(TOKEN)
    calls = []

    async def forbidden(*args):
        raise AssertionError('Unauthorized input reached body or application')

    async def send(message):
        calls.append(message)

    scope = {'type': 'http', 'path': INTERNAL_PATH, 'method': 'POST', 'headers': []}
    await InternalGradingMiddleware(forbidden, settings)(scope, forbidden, send)
    assert calls[0]['status'] == 401
    assert json.loads(calls[1]['body'])['error']['code'] == 'service_unauthorized'


@pytest.mark.parametrize('authorization', ['', 'Bearer wrong', 'Basic ' + TOKEN])
def test_service_auth_is_required(internal, authorization):
    client, _, providers = internal
    response = post(client, request_headers={**headers(), 'Authorization': authorization})
    assert response.status_code == 401
    assert_provenance(response)
    assert not providers


@pytest.mark.parametrize('request_id', [None, 'test-user-secret@example.org', 'x' * 4096])
def test_run_id_is_required_and_not_reflected_when_invalid(internal, request_id):
    client, _, providers = internal
    request_headers = headers()
    request_headers.pop('X-Request-ID')
    if request_id is not None:
        request_headers['X-Request-ID'] = request_id
    response = post(client, request_headers=request_headers)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'invalid_request_id'
    assert_provenance(response)
    if request_id:
        assert request_id not in response.text
    assert not providers


def test_capabilities_cover_all_seven_numbers_without_model_calls(internal):
    client, app, providers = internal
    response = client.get(INTERNAL_PATH + '/capabilities', headers=headers())
    assert response.status_code == 200
    body = response.json()
    assert body['provider_mode'] == 'mock'
    assert type(body['deadline_seconds']) is int
    assert body['deadline_seconds'] == 360
    assert body['max_solution_images'] == 4
    assert body['max_image_bytes'] == 8 * 1024 * 1024
    assert [(entry['task_number'], entry['max_score']) for entry in body['tasks']] == list(MAX_SCORES.items())
    for entry in body['tasks']:
        assert entry['supported'] == entry['package_available'] == (entry['task_number'] == 16)
        assert entry['response_contract'] == CONTRACT_VERSION
        assert 'handler_factory' not in entry and 'validator_factory' not in entry
    assert body['tasks'][2]['package_id'] == app.state.grading_capabilities[16].package_id
    assert_provenance(response)
    assert not providers


@pytest.mark.parametrize('deadline', [359.0, 359.5])
def test_capabilities_reject_non_contract_deadline_without_truncation(internal, deadline):
    client, app, providers = internal
    app.state.settings.photo.deadline_seconds = deadline
    response = client.get(INTERNAL_PATH + '/capabilities', headers=headers())
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'unsupported_contract'
    assert app.state.settings.photo.deadline_seconds == deadline
    assert providers == []


@pytest.mark.parametrize('number', [14, 15, 17, 18, 19, 20])
def test_other_registered_numbers_are_explicitly_unsupported(internal, number):
    client, _, providers = internal
    response = post(client, payload(number), image=b'not decoded for an unsupported package')
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'unsupported_task'
    assert_provenance(response)
    assert not providers


@pytest.mark.parametrize('solution', [None, 'Вычисления из банка: x > 2'])
def test_prepared_round_trip_preserves_snapshot_order_exact_bytes_and_prompts(internal, solution):
    client, app, providers = internal
    value = payload(count=4)
    value['task']['reference_solution'] = solution
    request_headers = headers()
    response = post(client, value, request_headers=request_headers)
    assert response.status_code == 200, response.text
    assert_provenance(response, selected=True)
    assert response.headers['x-request-id'] == request_headers['X-Request-ID']
    assert response.headers['x-grading-package-id'] == app.state.grading_capabilities[16].package_id
    body = response.json()
    assert body['task'] == value['task']
    assert body['solution_image_ids'] == value['solution_image_ids']
    assert body['grading']['score'] == 2
    assert set(body) == {'task', 'solution_image_ids', 'is_graded', 'rejection_reason', 'ocr', 'analysis', 'grading'}
    assert len(providers) == 1 and providers[0].closed
    assert response.content == providers[0].last_raw.encode('utf-8')
    assert all(tools for _, tools in providers[0].inputs), 'Prepared entry must never invoke task-photo OCR'
    model_payload = json.loads(providers[0].inputs[0][0][1]['content'][0]['text'])
    assert model_payload == {'task': value['task'], 'solution_image_ids': value['solution_image_ids']}
    assert value['task_version_id'] not in json.dumps(providers[0].inputs)
    assert TOKEN not in json.dumps(providers[0].inputs)
    assert 'private-filename.png' not in json.dumps(providers[0].inputs)
    assert app.state.photo_active == 0


@pytest.mark.parametrize('mutation', [
    lambda v: v.update(user_id='forbidden'),
    lambda v: v['task'].update(criteria_override='forbidden'),
    lambda v: v['task'].update(task_number=15, max_score=2),
    lambda v: v['task'].update(task_number=13),
    lambda v: v['task'].update(task_number=True),
    lambda v: v['task'].update(max_score=True),
    lambda v: v['task'].update(statement=''),
    lambda v: v['task'].update(statement='x' * 16001),
    lambda v: v['task'].update(reference_answer=' '),
    lambda v: v['task'].update(reference_solution='x' * 32001),
    lambda v: v['task'].update(id='../../private'),
    lambda v: v.update(task_version_id='test-user'),
    lambda v: v.update(solution_image_ids=[v['solution_image_ids'][0]] * 2),
    lambda v: v.update(solution_image_ids=['https://private.example/']),
])
def test_invalid_snapshot_never_reaches_provider(internal, mutation):
    client, _, providers = internal
    value = payload()
    mutation(value)
    response = post(client, value)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'invalid_task_snapshot'
    assert_provenance(response)
    assert not providers


@pytest.mark.parametrize('raw', ['{}', '[]', '{"task":{},"task":{}}', '{"task":NaN}', '{bad json', 'x' * (512 * 1024 + 1)])
def test_invalid_metadata_json_is_bounded_and_sanitized(internal, raw):
    client, _, providers = internal
    response = post(client, raw=raw)
    assert response.status_code == 422
    assert set(response.json()['error']) == {'code', 'message', 'details'}
    assert response.json()['error']['details'] == {}
    assert not providers
    assert_provenance(response)


def test_version_and_image_count_must_match(internal):
    client, _, providers = internal
    value = payload()
    value['contract_version'] = 'future'
    assert post(client, value).json()['error']['code'] == 'unsupported_contract'
    assert post(client, payload(count=2), count=1).json()['error']['code'] == 'invalid_task_snapshot'
    assert not providers


def test_lone_unicode_surrogate_is_rejected_before_provider(internal):
    client, _, providers = internal
    value = payload()
    value['task']['statement'] = '\ud800'
    response = post(client, raw=json.dumps(value))
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'invalid_task_snapshot'
    assert not providers


@pytest.mark.parametrize('extra', ['duplicate_metadata', 'text_field', 'metadata_file', 'five_photos'])
def test_multipart_allowlist_and_counts(internal, extra):
    client, _, providers = internal
    metadata = json.dumps(payload())
    parts = [('metadata', (None, metadata, 'application/json')),
             ('solution_images', ('photo.png', photo(), 'image/png'))]
    if extra == 'duplicate_metadata':
        parts.append(('metadata', (None, metadata, 'application/json')))
    elif extra == 'text_field':
        parts.append(('user_id', (None, 'forbidden')))
    elif extra == 'metadata_file':
        parts[0] = ('metadata', ('metadata.json', metadata, 'application/json'))
    else:
        parts.extend([parts[1]] * 4)
    response = client.post(INTERNAL_PATH, files=parts, headers=headers())
    assert response.status_code == 422
    assert_provenance(response)
    assert not providers


@pytest.mark.parametrize('content', [b'', b'not image', b'<svg/>', b'%PDF-1.7'])
def test_bad_images_rejected_without_provider(internal, content):
    client, _, providers = internal
    response = post(client, image=content)
    assert response.status_code == 422
    assert_provenance(response, selected=True)
    assert not providers


def test_file_and_stream_size_limits_without_content_length(internal, caplog):
    client, app, providers = internal
    response = post(client, image=b'x' * (8 * 1024 * 1024 + 1))
    assert response.status_code == 413
    assert_provenance(response, selected=True)
    prefix = b'--bounded\r\nContent-Disposition: form-data; name="solution_images"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n'

    def chunks():
        yield prefix
        for _ in range(34):
            yield b'x' * (1024 * 1024)
        yield b'\r\n--bounded--\r\n'

    response = client.post(INTERNAL_PATH, content=chunks(), headers={**headers(), 'Content-Type': 'multipart/form-data; boundary=bounded'})
    assert response.status_code == 413, (response.text, [getattr(record, 'error_type', '') for record in caplog.records])
    assert_provenance(response)
    assert app.state.photo_active == 0
    assert not providers


def test_bad_multipart_and_oversized_declared_body(internal):
    client, _, providers = internal
    for content_type, content in [('application/json', '{}'), ('multipart/form-data', 'missing boundary')]:
        response = client.post(INTERNAL_PATH, content=content, headers={**headers(), 'Content-Type': content_type})
        assert response.status_code == 422
        assert response.json()['error']['code'] == 'invalid_multipart'
        assert_provenance(response)
    response = client.post(INTERNAL_PATH, content=b'', headers={**headers(), 'Content-Length': str(MAX_BODY_BYTES + 1)})
    assert response.status_code == 413
    assert not providers


def test_shared_concurrency_limit_precedes_upload_work(internal):
    client, app, providers = internal
    app.state.photo_active = app.state.settings.photo.concurrency
    response = post(client)
    assert response.status_code == 429
    assert response.json()['error']['code'] == 'grading_busy'
    assert_provenance(response)
    assert not providers
    app.state.photo_active = 0


def test_deadline_closes_provider_and_releases_slot(internal, monkeypatch):
    client, app, _ = internal
    provider = RecordingProvider()

    async def blocked(*args):
        await asyncio.Event().wait()

    provider.chat = blocked
    monkeypatch.setattr('app.grading.service.MockProvider', lambda: provider)
    app.state.settings.photo.deadline_seconds = .05
    response = post(client)
    assert response.status_code == 504, response.text
    assert response.json()['error']['code'] == 'llm_timeout'
    assert_provenance(response, selected=True)
    assert provider.closed
    assert app.state.photo_active == 0


class RejectionProvider(RecordingProvider):
    def __init__(self, fail_after_rejection=False):
        super().__init__()
        self.fail_after_rejection = fail_after_rejection

    async def chat(self, messages, tools=None):
        self.inputs.append((deepcopy(messages), tools))
        request = json.loads(messages[1]['content'][0]['text'])
        raw = json.dumps({**request, 'is_graded': False, 'rejection_reason': ATTACK_REASON,
                          'ocr': None, 'analysis': None, 'grading': None}, ensure_ascii=False)
        sequence = [('read_file', {'path': name}) for name in READ_ORDER[:5]] + [
            ('set_rejection', {'reason': 'attack'}), ('set_rejection', {'reason': 'attack'}),
            ('read_file', {'path': 'response-format.md'}),
            ('write_file', {'path': 'response.json', 'content': raw}),
            ('validate_response', {'path': 'response.json'})]
        count = sum(bool(message.get('tool_calls')) for message in messages)
        if self.fail_after_rejection and count == 6:
            raise LLMError('Не удалось проверить работу')
        if count == len(sequence):
            self.last_raw = raw
            return {'role': 'assistant', 'content': raw}
        name, arguments = sequence[count]
        return {'role': 'assistant', 'tool_calls': [{'id': str(count), 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(arguments, ensure_ascii=False)}}]}


@pytest.mark.parametrize('fail', [False, True])
def test_attack_is_correlated_without_local_photos_even_after_error(internal, monkeypatch, tmp_path, caplog, fail):
    client, _, _ = internal
    provider = RejectionProvider(fail)
    monkeypatch.setattr('app.grading.service.MockProvider', lambda: provider)
    value = payload()
    request_headers = headers()
    response = post(client, value, request_headers=request_headers)
    assert response.status_code == (502 if fail else 200), response.text
    assert_provenance(response, selected=True)
    assert response.headers['x-grading-rejection-code'] == 'attack'
    records = [record for record in caplog.records if record.name == 'app.grading.internal_reports']
    assert len(records) == 1
    assert records[0].run_id == request_headers['X-Request-ID']
    assert records[0].solution_image_ids == value['solution_image_ids']
    assert not hasattr(records[0], 'user_id')
    assert not list(tmp_path.rglob('*.jpg')) and not list(tmp_path.rglob('report.json'))
    assert provider.closed
    if not fail:
        assert response.json()['grading'] is None
        assert response.json()['rejection_reason'] == ATTACK_REASON


def test_run_provider_mode_is_snapshotted_not_cached_capability(internal, monkeypatch):
    client, app, _ = internal
    assert client.get(INTERNAL_PATH + '/capabilities', headers=headers()).json()['provider_mode'] == 'mock'
    original = RecordingProvider()
    original_chat = original.chat

    async def change_settings(messages, tools=None):
        app.state.settings.llm.provider = 'mock'
        return await original_chat(messages, tools)

    original.chat = change_settings
    app.state.settings.llm.provider = 'openai'
    monkeypatch.setattr('app.grading.service.Provider', lambda settings: original)
    response = post(client)
    assert response.status_code == 200
    assert_provenance(response, selected=True, mode='live')
    assert app.state.settings.llm.provider == 'mock'
    response = post(client)
    assert response.status_code == 200
    assert_provenance(response, selected=True, mode='mock')


@pytest.mark.parametrize('wrong', ['score', 'task', 'images', 'schema'])
def test_handler_boundary_rejects_unbound_or_invalid_response(internal, wrong):
    client, app, _ = internal
    capability = app.state.grading_capabilities[16]

    class WrongHandler:
        def __init__(self, *args, **kwargs):
            pass

        async def run_prepared(self, task, ids, images, report):
            result = {'task': deepcopy(task), 'solution_image_ids': list(ids), 'is_graded': False,
                      'rejection_reason': 'Отказ', 'ocr': None, 'analysis': None, 'grading': None}
            if wrong == 'score':
                result['grading'] = {'score': 20, 'criterion': '', 'explanation': ''}
            elif wrong == 'task':
                result['task']['reference_answer'] = 'changed'
            elif wrong == 'images':
                result['solution_image_ids'] = [str(uuid4())]
            else:
                result['extra'] = 'no'
            return json.dumps(result)

    app.state.grading_capabilities[16] = replace(capability, handler_factory=WrongHandler)
    response = post(client)
    assert response.status_code == 502, response.text
    assert response.json()['error']['code'] == 'llm_bad_response'
    assert_provenance(response, selected=True)


def test_unexpected_failure_is_sanitized(internal):
    client, app, _ = internal
    capability = app.state.grading_capabilities[16]

    def failed(*args, **kwargs):
        raise OSError('PRIVATE PROVIDER BODY')

    app.state.grading_capabilities[16] = replace(capability, handler_factory=failed)
    response = post(client)
    assert response.status_code == 500
    assert 'PRIVATE' not in response.text
    assert response.json()['error']['code'] == 'internal_error'
    assert_provenance(response, selected=True)
    assert app.state.photo_active == 0


def test_package_digest_is_stable_and_changed_package_fails_closed(internal, monkeypatch):
    client, app, providers = internal
    capability = app.state.grading_capabilities[16]
    assert build_registry()[16].package_id == capability.package_id
    assert package_digest(dict(reversed(list(capability.package.items())))) == capability.package_id
    changed = dict(capability.package)
    changed['main.md'] += '\nchanged'
    monkeypatch.setattr('app.grading.capabilities.load_package', lambda number: changed)
    response = post(client)
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'grading_package_changed'
    assert not providers


def test_internal_paths_do_not_redirect_or_expose_other_methods(internal):
    client, _, providers = internal
    response = client.post(INTERNAL_PATH + '/', headers=headers(), follow_redirects=False)
    assert response.status_code == 404
    assert_provenance(response)
    assert client.get(INTERNAL_PATH, headers=headers()).status_code == 405
    assert not providers
