"""Grading-only isolation, validation and service authentication, always offline."""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest

from app.core.errors import LLMError, LLMResponseFormatError
from app.grading.expert_grading import grade_analysis, parse_request, MAX_BODY_BYTES
from app.main import create_app

PATH = '/internal/v1/grading/grade-analysis'
V2_PATH = '/internal/v2/grading/grade-analysis'


def payload():
    return {'contract_version': 'expert-grading.v1',
            'task': {'id': str(uuid4()), 'task_number': 16, 'max_score': 2,
                     'statement': 'x > 0', 'reference_answer': '(0; +∞)', 'reference_solution': None},
            'ocr_block_ids': ['a', 'b', 'c'],
            'analysis': {'block_reviews': [
                {'block_id': 'a', 'status': 'error', 'explanation': 'Ошибка', 'follows_from_block_ids': []},
                {'block_id': 'b', 'status': 'follow_through', 'explanation': 'Следствие', 'follows_from_block_ids': ['a']},
                {'block_id': 'c', 'status': 'follow_through', 'explanation': 'Следствие', 'follows_from_block_ids': ['a']}],
                'summary': 'Рецензия эксперта', 'checks': None, 'student_answer': None,
                'strengths': [], 'findings': []}}


def auth():
    return {'Authorization': 'Bearer test-expert-token', 'X-Request-ID': str(uuid4())}


@pytest.fixture
def client(settings):
    settings.internal_grading.enabled = True
    settings.internal_grading.token = SecretStr('test-expert-token')
    settings.llm.provider = 'mock'
    with TestClient(create_app(settings)) as client:
        yield client


def test_mock_stage_only_and_provenance(client, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('Full pipeline or paid provider must not run')
    monkeypatch.setattr('app.grading.service.GradingService.run_prepared', forbidden)
    monkeypatch.setattr('app.grading.expert_grading.Provider', forbidden)
    value = payload()
    before = deepcopy(value)
    response = client.post(PATH, json=value, headers=auth())
    assert response.status_code == 200, response.text
    assert set(response.json()) == {'grading'}
    assert response.json()['grading']['score'] == 1
    assert 'mock' in response.json()['grading']['criterion']
    assert value == before
    assert response.headers['x-grading-contract-version'] == 'expert-grading.v1'
    assert response.headers['x-grading-provider-mode'] == 'mock'
    assert response.headers['x-grading-package-id'].startswith('sha256:')
    assert response.headers['cache-control'] == 'no-store'
    assert client.app.state.photo_active == 0


def test_auth_before_parse_and_disabled_route(settings, client):
    assert client.post(PATH, content='not-json').status_code == 401
    settings.internal_grading.enabled = False
    with TestClient(create_app(settings)) as disabled:
        assert disabled.post(PATH, json=payload(), headers=auth()).status_code == 404


@pytest.mark.parametrize('change', ['missing_review', 'duplicate', 'dangling', 'forward', 'nonerror', 'extra_ocr', 'score_scale'])
def test_invalid_input_never_invokes_provider(client, monkeypatch, change):
    def forbidden(*args, **kwargs):
        raise AssertionError('Invalid input reached provider')
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', forbidden)
    value = payload()
    reviews = value['analysis']['block_reviews']
    if change == 'missing_review': reviews.pop()
    elif change == 'duplicate': reviews[1]['block_id'] = 'a'
    elif change == 'dangling': reviews[1]['follows_from_block_ids'] = ['absent']
    elif change == 'forward': reviews[0].update(status='follow_through', follows_from_block_ids=['b'])
    elif change == 'nonerror': reviews[0]['status'] = 'correct'
    elif change == 'extra_ocr': value['ocr'] = {'blocks': []}
    else: value['task']['max_score'] = 3
    assert client.post(PATH, json=value, headers=auth()).status_code == 422
    assert client.app.state.photo_active == 0


def test_stream_limit_duplicates_and_request_id(client):
    headers = {**auth(), 'Content-Type': 'application/json'}
    assert client.post(PATH, content=b' ' * (MAX_BODY_BYTES + 1), headers=headers).status_code == 413
    raw = json.dumps(payload()).replace('"analysis":', '"analysis":{},"analysis":')
    assert client.post(PATH, content=raw, headers=headers).status_code == 422
    headers.pop('X-Request-ID')
    assert client.post(PATH, json=payload(), headers=headers).status_code == 422


async def test_live_stage_uses_only_analysis_and_returns_exact_validated_bytes():
    request = parse_request(json.dumps(payload()).encode())
    before = request.model_dump()
    raw = '{"grading": {"score": 1,"criterion":"Критерий","explanation":"По анализу"}}'
    provider = SimpleNamespace(chat=AsyncMock(return_value={'content': raw}), close=AsyncMock())
    result = await grade_analysis(request, SimpleNamespace(llm=SimpleNamespace(provider='live')),
                                  {'criteria.md': 'CRITERIA', 'popular_mistakes.md': 'CATALOG'}, provider=provider)
    assert result == raw
    assert request.model_dump() == before
    provider.chat.assert_awaited_once()
    args = provider.chat.call_args
    assert len(args.args) == 1 and not args.kwargs
    messages = args.args[0]
    assert all(isinstance(m['content'], str) for m in messages)
    data = json.loads(messages[1]['content'])
    assert set(data) == {'task', 'analysis'}
    assert data['analysis'] == before['analysis']
    assert 'CRITERIA' in messages[0]['content'] and 'CATALOG' in messages[0]['content']
    provider.close.assert_awaited_once()


@pytest.mark.parametrize('message', [
    {'content': '{"grading":{"score":3,"criterion":"x","explanation":"y"}}'},
    {'content': '{"grading":{"score":true,"criterion":"x","explanation":"y"}}'},
    {'content': '{"grading":{"score":1,"criterion":"x","explanation":"y"},"analysis":{}}'},
    {'content': '{}', 'tool_calls': [{'function': {'name': 'review_image'}}]},
    {'content': '{"grading":{"score":1,"score":2,"criterion":"x","explanation":"y"}}'},
])
async def test_invalid_model_grade_fails_without_clamp(message):
    provider = SimpleNamespace(chat=AsyncMock(return_value=message), close=AsyncMock())
    with pytest.raises(LLMResponseFormatError):
        await grade_analysis(parse_request(json.dumps(payload()).encode()),
                             SimpleNamespace(llm=SimpleNamespace(provider='live')),
                             {'criteria.md': '', 'popular_mistakes.md': ''}, provider=provider)
    provider.chat.assert_awaited_once()
    provider.close.assert_awaited_once()


def test_unanalysed_ocr_and_lone_surrogate_rejected(client):
    value = payload()
    value['analysis'].update(summary=None, block_reviews=[
        {'block_id': key, 'status': None, 'explanation': None, 'follows_from_block_ids': []}
        for key in value['ocr_block_ids']])
    assert client.post(PATH, json=value, headers=auth()).status_code == 422
    value['analysis']['summary'] = 'Завершённая рецензия legacy'
    assert client.post(PATH, json=value, headers=auth()).status_code == 200
    value['analysis']['summary'] = chr(0xd800)
    assert client.post(PATH, content=json.dumps(value),
                       headers={**auth(), 'Content-Type': 'application/json'}).status_code == 422


async def test_cancelled_grading_closes_provider():
    import asyncio
    provider = SimpleNamespace(chat=AsyncMock(side_effect=asyncio.CancelledError), close=AsyncMock())
    with pytest.raises(asyncio.CancelledError):
        await grade_analysis(parse_request(json.dumps(payload()).encode()),
                             SimpleNamespace(llm=SimpleNamespace(provider='live')),
                             {'criteria.md': '', 'popular_mistakes.md': ''}, provider=provider)
    provider.close.assert_awaited_once()


@pytest.fixture
def local_client(settings, monkeypatch):
    settings.internal_grading.enabled = True
    settings.internal_grading.token = SecretStr('test-expert-token')
    settings.local_demo_ai.enabled = True
    settings.local_demo_ai.allow_live = False
    settings.llm.provider = 'mock'
    def forbidden(*args, **kwargs):
        raise AssertionError('Full pipeline or paid provider must not run')
    monkeypatch.setattr('app.grading.expert_grading.Provider', forbidden)
    monkeypatch.setattr('app.grading.v2_service.run_prepared', forbidden)
    monkeypatch.setattr('app.grading.v2_service.run_from_images', forbidden)
    with TestClient(create_app(settings)) as client:
        yield client


def test_v2_discovery_does_not_expand_v1(local_client):
    v1 = local_client.get('/internal/v1/grading/capabilities', headers=auth()).json()
    v2 = local_client.get('/internal/v2/grading/capabilities', headers=auth()).json()
    assert {task['task_number'] for task in v1['tasks'] if task['supported']} == {16}
    assert 'grade_analysis' not in v1
    assert v2['grade_analysis'] == {'path': V2_PATH, 'contract_version': 'expert-grading.v1'}
    assert {task['task_number'] for task in v2['tasks'] if task['supported']} == {14, 16, 17, 18}


@pytest.mark.parametrize('number,maximum', [(14, 2), (16, 2), (17, 2), (18, 3)])
def test_local_grade_only_supports_approved_tasks_and_records_real_stages(local_client, number, maximum):
    value, headers = payload(), auth()
    value['task'].update(task_number=number, max_score=maximum)
    response = local_client.post(V2_PATH, json=value, headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers['x-grading-contract-version'] == 'expert-grading.v1'
    assert response.headers['x-request-id'] == headers['X-Request-ID']
    assert response.headers['x-grading-provider-mode'] == 'mock'
    assert response.headers['x-grading-package-id'].startswith('sha256:')
    assert response.headers['cache-control'] == 'no-store'
    assert set(response.json()) == {'grading'}
    assert response.json()['grading']['score'] == maximum - 1
    run = '/internal/v2/grading/runs/' + headers['X-Request-ID']
    events = local_client.get(run + '/events', headers=auth()).json()['items']
    assert [event['phase'] for event in events if event['type'] == 'stage_started'] == ['input', 'grading', 'validation']
    assert not any(event['type'].startswith('model_') for event in events)  # Mock made no model call.
    assert events[-1]['type'] == 'completed'
    artifact_id = events[-1]['data']['artifact_id']
    artifact = local_client.get(run + '/artifacts/' + artifact_id, headers=auth())
    assert artifact.json() == response.json()['grading']
    assert local_client.app.state.photo_active == 0
    replay = local_client.post(V2_PATH, json=value, headers=headers)
    assert replay.status_code == 409


@pytest.mark.parametrize('path', [PATH, V2_PATH])
@pytest.mark.parametrize('raw', [
    '{"grading":{"score":3,"criterion":"x","explanation":"y"}}',
    '{"grading":{"score":1,"score":2,"criterion":"x","explanation":"y"}}',
    '{"grading":{"score":1,"criterion":" ","explanation":"y"}}',
    '{"grading":{"score":1,"criterion":"x","explanation":"y"},"analysis":{}}',
    '{"grading":{"score":true,"criterion":"x","explanation":"y"}}',
])
def test_http_independently_rejects_invalid_service_result(local_client, monkeypatch, path, raw):
    stage = AsyncMock(return_value=raw)
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', stage)
    response = local_client.post(path, json=payload(), headers=auth())
    assert response.status_code == 502
    assert response.json()['error']['code'] == 'llm_bad_response'
    assert 'grading' not in response.json()
    stage.assert_awaited_once()
    assert local_client.app.state.photo_active == 0


@pytest.mark.parametrize('path', [PATH, V2_PATH])
def test_http_preserves_exact_validated_bytes(local_client, monkeypatch, path):
    raw = '{"grading": {"score": 1,"criterion":"Критерий","explanation":"По анализу"}}'
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', AsyncMock(return_value=raw))
    response = local_client.post(path, json=payload(), headers=auth())
    assert response.status_code == 200
    assert response.content == raw.encode('utf-8')


@pytest.mark.parametrize('change', ['unsupported', 'wrong_max', 'missing_nullable', 'nested_type', 'empty_reference', 'wrong_contract', 'extra_image'])
def test_v2_invalid_input_never_dispatches(local_client, monkeypatch, change):
    stage = AsyncMock(side_effect=AssertionError('Invalid input reached provider'))
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', stage)
    value = payload()
    if change == 'unsupported': value['task']['task_number'] = 15
    elif change == 'wrong_max': value['task']['max_score'] = 3
    elif change == 'missing_nullable': del value['analysis']['summary']
    elif change == 'nested_type': value['analysis']['block_reviews'][0]['follows_from_block_ids'] = {}
    elif change == 'empty_reference': value['task']['reference_solution'] = ' '
    elif change == 'wrong_contract': value['contract_version'] = 'expert-review.v2'
    else: value['imageArtifacts'] = []
    response = local_client.post(V2_PATH, json=value, headers=auth())
    assert response.status_code == 422
    stage.assert_not_awaited()
    assert local_client.app.state.photo_active == 0


def test_v2_auth_live_gate_and_size_limit_precede_dispatch(local_client, monkeypatch):
    stage = AsyncMock(side_effect=AssertionError('Rejected request reached provider'))
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', stage)
    assert local_client.post(V2_PATH, content=b'not-json').status_code == 401
    assert local_client.post(V2_PATH, content=b' ' * (MAX_BODY_BYTES + 1), headers=auth()).status_code == 413
    local_client.app.state.settings.llm.provider = 'openai'
    response = local_client.post(V2_PATH, json=payload(), headers=auth())
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'live_provider_disabled'
    assert response.headers['x-grading-contract-version'] == 'expert-grading.v1'
    stage.assert_not_awaited()


async def test_grade_only_model_events_and_transport_failure_never_retry():
    from app.grading.observability import RunStore
    trace = RunStore().start(str(uuid4()), provider_mode='live')
    provider = SimpleNamespace(chat=AsyncMock(side_effect=LLMError('Transport failed', retryable=False)), close=AsyncMock())
    with pytest.raises(LLMError):
        await grade_analysis(parse_request(json.dumps(payload()).encode()),
                             SimpleNamespace(llm=SimpleNamespace(provider='live')),
                             {'criteria.md': 'PRIVATE CRITERIA', 'popular_mistakes.md': 'PRIVATE CATALOG'},
                             provider=provider, trace=trace)
    provider.chat.assert_awaited_once()
    provider.close.assert_awaited_once()
    events = trace.store.events(trace.run_id)['items']
    calls = [event for event in events if event['type'].startswith('model_')]
    assert [event['type'] for event in calls] == ['model_started', 'model_failed']
    assert calls[0]['data']['call_id'] == calls[1]['data']['call_id']
    assert 'PRIVATE' not in json.dumps(events)


def test_canonical_v2_step_and_image_share_one_grade_only_review(local_client):
    # Backend projects only stable IDs and the existing analysis; content is never submitted.
    canonical = {'version': 'expert-review.v2', 'ocr': {'blocks': [
        {'id': 'a', 'title': 'Чертёж и вычисление', 'content': {'type': 'step', 'lines': ['AB=3'],
            'image': {'type': 'image', 'artifact_id': str(uuid4()), 'alt': 'Чертёж'}}}]},
        'analysis': payload()['analysis']}
    canonical['analysis']['block_reviews'] = canonical['analysis']['block_reviews'][:1]
    value = payload()
    value['ocr_block_ids'] = [block['id'] for block in canonical['ocr']['blocks']]
    value['analysis'] = canonical['analysis']
    before = deepcopy(canonical)
    response = local_client.post(V2_PATH, json=value, headers=auth())
    assert response.status_code == 200
    assert canonical == before
    assert set(response.json()) == {'grading'}


def test_local_grade_only_absent_when_disabled_or_production(settings):
    settings.internal_grading.enabled = False
    settings.internal_grading.token = SecretStr('test-expert-token')
    for enabled, environment in [(False, 'local'), (True, 'prod')]:
        settings.local_demo_ai.enabled = enabled
        settings.app.env = environment
        with TestClient(create_app(settings)) as client:
            assert client.post(V2_PATH, json=payload(), headers=auth()).status_code == 404


@pytest.mark.parametrize('path', [PATH, V2_PATH])
def test_streamed_grade_only_body_limit_without_content_length(local_client, monkeypatch, path):
    stage = AsyncMock(side_effect=AssertionError('Oversized stream reached provider'))
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', stage)
    response = local_client.post(path, content=iter([b' ' * (MAX_BODY_BYTES // 2)] * 3),
                                 headers={**auth(), 'Content-Type': 'application/json'})
    assert 'content-length' not in response.request.headers
    assert response.status_code == 413, response.text
    stage.assert_not_awaited()
    assert local_client.app.state.photo_active == 0


@pytest.mark.parametrize('path', [PATH, V2_PATH])
def test_grade_only_shares_concurrency_slot(local_client, monkeypatch, path):
    stage = AsyncMock(side_effect=AssertionError('Busy request reached provider'))
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', stage)
    local_client.app.state.photo_active = local_client.app.state.settings.photo.concurrency
    response = local_client.post(path, json=payload(), headers=auth())
    assert response.status_code == 429
    assert response.json()['error']['code'] == 'grading_busy'
    assert local_client.app.state.photo_active == local_client.app.state.settings.photo.concurrency
    stage.assert_not_awaited()


def test_v2_grade_only_deadline_fails_without_artifact(local_client, monkeypatch):
    import asyncio
    cleanup = []
    async def stalled(*args, **kwargs):
        try:
            await asyncio.sleep(10)
        finally:
            cleanup.append(True)
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', stalled)
    local_client.app.state.settings.photo.deadline_seconds = 0.02
    headers = auth()
    response = local_client.post(V2_PATH, json=payload(), headers=headers)
    assert response.status_code == 504
    assert response.json()['error']['code'] == 'llm_timeout'
    assert cleanup == [True]
    assert local_client.app.state.photo_active == 0
    events = local_client.app.state.grading_v2_store.events(headers['X-Request-ID'])['items']
    assert events[-1]['type'] == 'failed'
    assert events[-1]['data']['code'] == 'llm_timeout'
    assert not any(event['type'] in ('completed', 'artifact_ready') for event in events)


def test_v2_grade_only_package_change_rejects_completed_model_result(local_client, monkeypatch):
    from app.api import routes_grading_v2
    original = routes_grading_v2.package_descriptor
    async def changed(*args, **kwargs):
        monkeypatch.setattr(routes_grading_v2, 'package_descriptor',
                            lambda number: {**original(number), 'package_id': 'sha256:' + '0' * 64})
        return '{"grading":{"score":1,"criterion":"x","explanation":"y"}}'
    monkeypatch.setattr('app.grading.expert_grading.grade_analysis', changed)
    headers = auth()
    response = local_client.post(V2_PATH, json=payload(), headers=headers)
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'grading_package_changed'
    events = local_client.app.state.grading_v2_store.events(headers['X-Request-ID'])['items']
    assert not any(event['type'] == 'artifact_ready' for event in events)


async def test_grade_only_model_success_event_has_no_response_content():
    from app.grading.observability import RunStore
    trace = RunStore().start(str(uuid4()), provider_mode='live')
    raw = '{"grading":{"score":1,"criterion":"Критерий","explanation":"Личный ответ"}}'
    provider = SimpleNamespace(chat=AsyncMock(return_value={'content': raw}), close=AsyncMock())
    await grade_analysis(parse_request(json.dumps(payload()).encode()),
                         SimpleNamespace(llm=SimpleNamespace(provider='live')),
                         {'criteria.md': 'PRIVATE CRITERIA', 'popular_mistakes.md': 'PRIVATE CATALOG'},
                         provider=provider, trace=trace)
    events = trace.store.events(trace.run_id)['items']
    calls = [event for event in events if event['type'].startswith('model_')]
    assert [event['type'] for event in calls] == ['model_started', 'model_completed']
    assert calls[0]['data']['call_id'] == calls[1]['data']['call_id']
    assert calls[1]['data']['duration_ms'] >= 0
    assert 'Личный ответ' not in json.dumps(events, ensure_ascii=False)
    assert 'PRIVATE' not in json.dumps(events)
    provider.close.assert_awaited_once()
