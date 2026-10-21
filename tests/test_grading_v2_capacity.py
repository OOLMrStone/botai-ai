"""Bounded, acknowledged evidence reclamation; no provider/network calls."""
import json
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
import pytest

from app.grading.observability import RunStore, Artifact
from app.grading.internal_contract import InternalGradingError
from app.main import create_app

BASE = '/internal/v2/grading'


def terminal(store):
    trace = store.start(str(uuid4()), provider_mode='mock')
    trace.emit('completed', 'validation')
    return trace.run_id


def test_33_acknowledged_terminal_records_reclaim_but_unacknowledged_do_not():
    store = RunStore()
    first = terminal(store)
    store.acknowledge(first)
    assert first not in store._runs and store._bytes == 0
    with pytest.raises(InternalGradingError) as caught:
        store.events(first)
    assert caught.value.status_code == 404
    for _ in range(31):
        terminal(store)
    assert store.available_records() == 1
    latest = terminal(store)
    assert latest in store._runs and first not in store._runs
    assert len(store._runs) == 32 and len(store._tombstones) == 1
    with pytest.raises(InternalGradingError) as caught:
        terminal(store)
    assert caught.value.code == 'run_store_full'
    assert store.available_records() == 0
    with pytest.raises(InternalGradingError) as caught:
        store.start(first, provider_mode='mock')
    assert caught.value.code == 'duplicate_run'
    store.acknowledge(first)  # An ACK retried after pressure remains idempotent.


def test_active_ack_rejected_and_tombstones_bounded_until_original_expiry():
    now = [0.0]
    store = RunStore(clock=lambda: now[0], ttl_seconds=30, max_runs=1, max_tombstones=1)
    trace = store.start(str(uuid4()), provider_mode='mock')
    with pytest.raises(InternalGradingError) as caught:
        store.acknowledge(trace.run_id)
    assert caught.value.code == 'run_active'
    trace.emit('failed', 'ocr')
    store.acknowledge(trace.run_id)
    now[0] = 10
    second_trace = store.start(str(uuid4()), provider_mode='mock')
    second = second_trace.run_id
    artifact_id = str(uuid4())
    store.add_artifact(second, artifact_id, Artifact(b'private evidence', 'image/jpeg', {'kind': 'diagram'}))
    second_trace.emit('completed', 'validation')
    store.acknowledge(second)
    assert store.available_records() == 0
    with pytest.raises(InternalGradingError) as caught:
        terminal(store)
    assert caught.value.code == 'run_store_full'
    assert len(store._tombstones) == 1 and second in store._runs
    assert not store._runs[second].events and not store._runs[second].artifacts
    assert store._bytes == 0
    store.acknowledge(second)
    with pytest.raises(InternalGradingError) as caught:
        store.events(second)
    assert caught.value.status_code == 404
    with pytest.raises(InternalGradingError) as caught:
        store.artifact(second, artifact_id)
    assert caught.value.status_code == 404
    with pytest.raises(InternalGradingError) as caught:
        store.start(second, provider_mode='mock')
    assert caught.value.code == 'duplicate_run'
    now[0] = 30
    assert store.available_records() == 1  # First tombstone expires at 30, not at eviction+30.
    with pytest.raises(InternalGradingError) as caught:
        store.acknowledge(trace.run_id)
    assert caught.value.status_code == 404
    store.start(trace.run_id, provider_mode='mock')
    assert len(store._runs) == 1 and second in store._tombstones
    with pytest.raises(InternalGradingError) as caught:
        store.acknowledge(str(uuid4()))
    assert caught.value.status_code == 404


def test_byte_pressure_reclaims_only_acknowledged_other_records():
    store = RunStore(max_bytes=13000)
    old = store.start(str(uuid4()), provider_mode='mock')
    store.add_artifact(old.run_id, str(uuid4()), Artifact(b'x' * 4000, 'image/jpeg', {'kind': 'diagram'}))
    old.emit('completed', 'validation')
    active = store.start(str(uuid4()), provider_mode='mock')
    artifact_id = str(uuid4())
    artifact = Artifact(b'y' * 6000, 'image/jpeg', {'kind': 'diagram'})
    with pytest.raises(InternalGradingError) as caught:
        store.add_artifact(active.run_id, artifact_id, artifact)
    assert caught.value.code == 'run_store_full'
    assert old.run_id in store._runs and active.run_id in store._runs
    store.acknowledge(old.run_id)
    store.add_artifact(active.run_id, artifact_id, artifact)
    assert old.run_id not in store._runs and old.run_id in store._tombstones
    assert store.artifact(active.run_id, artifact_id).data == artifact.data
    assert store._bytes <= store.max_bytes
    assert store._bytes == sum(r.byte_size for r in store._runs.values())


def test_failed_initial_reservation_does_not_leak_record():
    store = RunStore(max_bytes=1)
    with pytest.raises(InternalGradingError):
        store.start(str(uuid4()), provider_mode='mock')
    assert store._runs == {} and store._bytes == 0


@pytest.fixture
def local(settings):
    settings.llm.provider = 'mock'
    settings.internal_grading.enabled = False
    settings.internal_grading.token = SecretStr('capacity-test')
    settings.local_demo_ai.enabled = True
    settings.local_demo_ai.allow_live = False
    with TestClient(create_app(settings)) as client:
        yield client


def auth(run_id=None):
    return {'Authorization': 'Bearer capacity-test', 'X-Request-ID': run_id or str(uuid4())}


def post(client, run_id):
    image = BytesIO()
    Image.new('RGB', (40, 30), 'white').save(image, 'PNG')
    data = {'contract_version': 'photo-grade.v2', 'task_version_id': str(uuid4()),
            'solution_image_ids': [str(uuid4())], 'task': {'id': str(uuid4()), 'task_number': 16,
            'max_score': 2, 'statement': 'x > 0', 'reference_answer': '(0; +∞)', 'reference_solution': None}}
    return client.post(BASE, headers=auth(run_id), files=[
        ('metadata', (None, json.dumps(data), 'application/json')),
        ('solution_images', ('synthetic.png', image.getvalue(), 'image/png'))])


def test_http_ack_capacity_auth_readability_and_33_completed_runs(local):
    first = None
    for index in range(33):
        run_id = str(uuid4())
        first = first or run_id
        response = post(local, run_id)
        assert response.status_code == 200, response.text
        path = BASE + '/runs/' + run_id
        assert local.delete(path).status_code == 401
        events = local.get(path + '/events', headers=auth()).json()['items']
        artifact_id = next(e['data']['artifact_id'] for e in events if e['type'] == 'completed')
        artifact_path = path + '/artifacts/' + artifact_id
        assert local.get(artifact_path, headers=auth()).status_code == 200
        assert local.app.state.grading_v2_store._bytes > 0
        assert local.delete(path, headers=auth()).status_code == 204
        assert local.get(artifact_path, headers=auth()).status_code == 404
        assert local.app.state.grading_v2_store._bytes == 0
        assert local.app.state.grading_v2_store.available_records() == 32
        assert local.delete(path, headers=auth()).status_code == 204
        assert local.get(path + '/events', headers=auth()).status_code == 404
    assert local.app.state.photo_active == 0
    caps = local.get(BASE + '/capabilities', headers=auth()).json()
    assert caps['concurrency'] == local.app.state.settings.photo.concurrency
    assert caps['available_run_records'] == 32
    assert post(local, first).status_code == 409
    assert local.delete(BASE + '/runs/' + first, headers=auth()).status_code == 204


def test_http_busy_before_trace_allocation_and_active_ack(local):
    store = local.app.state.grading_v2_store
    trace = store.start(str(uuid4()), provider_mode='mock')
    response = local.delete(BASE + '/runs/' + trace.run_id, headers=auth())
    assert response.status_code == 409 and response.json()['error']['code'] == 'run_active'
    local.app.state.photo_active = local.app.state.settings.photo.concurrency
    before = len(store._runs)
    for _ in range(40):
        response = local.post(BASE, headers=auth(), content=b'not multipart')
        assert response.status_code == 429
    assert len(store._runs) == before and store._bytes == sum(r.byte_size for r in store._runs.values())
    local.app.state.photo_active = 0


@pytest.mark.parametrize('pressure', ['bytes', 'events'])
@pytest.mark.parametrize('outcome', ['failed', 'cancelled', 'completed'])
def test_terminal_outcome_survives_full_store_and_is_acknowledgeable(pressure, outcome):
    from app.grading.observability import MAX_EVENTS, TERMINAL_EVENT_BYTES
    store = RunStore(max_bytes=100000)
    trace = store.start(str(uuid4()), provider_mode='mock')
    if pressure == 'bytes':
        metadata = {'kind': 'diagram'}
        remaining = store.max_bytes - store._bytes - len(json.dumps(metadata).encode())
        store.add_artifact(trace.run_id, str(uuid4()), Artifact(b'x' * remaining, 'image/jpeg', metadata))
        assert store._bytes == store.max_bytes
    else:
        for _ in range(MAX_EVENTS - 2):
            trace.emit('model_started', 'ocr')
        assert len(store.events(trace.run_id, limit=100)['items']) == 100
    with pytest.raises(InternalGradingError):
        trace.emit('stage_failed', 'ocr')
    trace.emit(outcome, 'ocr', {'code': 'llm_bad_response', 'diagnostic_code': 605,
                               'failure_category': 'model_response', 'reason_code': 'unicode_math_script',
                               'issue_paths': ['$.long_property_name' * 20] * 30})
    record = store._runs[trace.run_id]
    assert record.terminal and record.terminal_reserve == 0
    assert record.events[-1]['type'] == outcome
    assert record.events[-1]['data']['reason_code'] == 'unicode_math_script'
    assert len(json.dumps(record.events[-1]).encode()) <= TERMINAL_EVENT_BYTES
    assert len(record.events) <= MAX_EVENTS
    assert store._bytes <= store.max_bytes
    assert store._bytes == sum(r.byte_size for r in store._runs.values())
    store.acknowledge(trace.run_id)
    assert record.acknowledged and not record.events and not record.artifacts
    assert store._bytes == 0


@pytest.mark.parametrize('pressure', ['bytes', 'events'])
def test_stage_failure_logging_never_replaces_original_exception(pressure):
    from app.core.errors import LLMError
    from app.grading.observability import MAX_EVENTS
    store = RunStore(max_bytes=100000)
    trace = store.start(str(uuid4()), provider_mode='mock')
    original = LLMError('Safe original failure', retryable=False)
    with pytest.raises(LLMError) as caught:
        with trace.stage('analysis'):
            if pressure == 'bytes':
                metadata = {'kind': 'diagram'}
                remaining = store.max_bytes - store._bytes - len(json.dumps(metadata).encode())
                store.add_artifact(trace.run_id, str(uuid4()), Artifact(b'x' * remaining, 'image/jpeg', metadata))
            else:
                while len(store._runs[trace.run_id].events) < MAX_EVENTS - 1:
                    trace.emit('model_started', 'analysis')
            raise original
    assert caught.value is original
    trace.emit('failed', 'analysis', {'code': original.code})
    store.acknowledge(trace.run_id)
    assert trace.run_id not in store._runs and store._bytes == 0


@pytest.mark.parametrize('failure_kind', ['provider', 'format'])
async def test_trace_exhaustion_stops_retries_and_preserves_provider_or_validation_failure(failure_kind):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from app.core.errors import LLMError, LLMResponseFormatError
    from app.grading.retry import run_step
    from app.grading.v2_service import ObservedProvider
    store = RunStore(max_bytes=100000)
    trace = store.start(str(uuid4()), provider_mode='mock')
    original = LLMError('Safe provider failure', retryable=True) if failure_kind == 'provider' else LLMResponseFormatError('Safe invalid response')
    calls = 0

    async def fail(*args, **kwargs):
        nonlocal calls
        calls += 1
        metadata = {'kind': 'diagram'}
        remaining = store.max_bytes - store._bytes - len(json.dumps(metadata).encode())
        store.add_artifact(trace.run_id, str(uuid4()), Artifact(b'x' * remaining, 'image/jpeg', metadata))
        raise original

    observed = ObservedProvider(SimpleNamespace(chat=fail), trace, 'grading')

    async def operation(attempt):
        if failure_kind == 'provider':
            return await observed.chat([])
        return await fail()

    with pytest.raises(type(original)) as caught:
        with trace.stage('grading'):
            await run_step(trace, 'grading', 'grading', operation)
    assert caught.value is original and calls == 1
    trace.emit('failed', 'grading', {'code': original.code})
    assert not any(e['type'] == 'retry' for e in store._runs[trace.run_id].events)
    store.acknowledge(trace.run_id)
    assert trace.run_id not in store._runs and store._bytes == 0
