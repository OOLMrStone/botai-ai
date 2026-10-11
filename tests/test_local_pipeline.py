"""Local diagnostics keep the current bounded pipeline and exact result contract."""
import asyncio
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.errors import LLMError, LLMResponseFormatError
from app.grading.images import SafeImage
from app.grading.package import COMMON_NAMES, load_package
from app.grading.provider import MockProvider, Provider
from app.grading.service import GradingService


TASK = {'id': 'local-task-16', 'task_number': 16, 'max_score': 2,
        'statement': 'x > 0', 'reference_answer': '(0; +∞)', 'reference_solution': None}
IDS = ['local-image-1']
IMAGES = [SafeImage(b'private-student-image')]


def config(tmp_path):
    return SimpleNamespace(photo=SimpleNamespace(reports_dir=str(tmp_path), max_model_turns=16),
                           llm=SimpleNamespace(provider='mock', api_key='private-test-key'))


class RecordingMock(MockProvider):
    def __init__(self):
        self.inputs = []
        self.closed = False

    async def chat(self, messages, tools=None):
        self.inputs.append(deepcopy(messages))
        result = await super().chat(messages, tools)
        result['reasoning_content'] = 'private-reasoning-marker'
        return result

    async def close(self):
        self.closed = True


async def run(service):
    return await service.run_prepared(TASK, IDS, IMAGES, AsyncMock())


async def test_observer_preserves_provider_messages_and_exact_validated_result(tmp_path):
    events = []
    observed_provider, default_provider = RecordingMock(), RecordingMock()
    observer = lambda *event: events.append(event)
    observed = await run(GradingService(config(tmp_path), observed_provider, observer=observer))
    default = await run(GradingService(config(tmp_path), default_provider))
    assert observed == default
    assert observed_provider.inputs == default_provider.inputs
    assert observed_provider.closed and default_provider.closed
    kinds = [kind for kind, _, _ in events]
    assert kinds[0] == 'start' and kinds[-1] == 'final'
    assert kinds.count('model_request') == kinds.count('model_response') == 13
    writes = {details['path']: details['content'] for kind, _, details in events
              if kind == 'tool_result' and details['tool'] == 'write_file'}
    assert set(writes) == {'ocr_result.md', 'notes.md', 'response.json'}
    assert writes['response.json'] == observed
    assert any(kind == 'validation' and details['valid'] for kind, _, details in events)
    log = json.dumps(events)
    assert 'private-reasoning-marker' not in log
    assert 'private-test-key' not in log
    assert 'base64' not in log and 'image_url' not in log


async def test_failed_observer_does_not_change_result(tmp_path):
    def failing_observer(*_):
        raise RuntimeError('local window has closed')
    result = await run(GradingService(config(tmp_path), MockProvider(), observer=failing_observer))
    assert json.loads(result)['grading']['score'] == 2


@pytest.mark.parametrize('layout', ['tasks', 'prompts'])
async def test_external_package_and_validator_use_same_local_root(tmp_path, layout):
    package = load_package()
    package['main.md'] += '\nLOCAL PACKAGE MARKER'
    paths = {}
    for name, content in package.items():
        if layout == 'tasks':
            path = tmp_path / 'tasks' / ('common' if name in COMMON_NAMES else '16') / 'prompts' / name
        else:
            path = tmp_path / 'prompts' / ('common' if name in COMMON_NAMES else '16') / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        paths[name] = path
    provider = RecordingMock()
    result = await run(GradingService(config(tmp_path), provider, package_root=tmp_path))
    assert json.loads(result)['is_graded']
    assert 'LOCAL PACKAGE MARKER' in provider.inputs[0][0]['content']
    paths['popular_mistakes.md'].write_text('No error-code rows', encoding='utf-8')
    with pytest.raises(LLMResponseFormatError):
        await run(GradingService(config(tmp_path), MockProvider(), package_root=tmp_path))


async def test_heartbeat_cancellation_is_closed_and_has_no_orphan_task(tmp_path):
    events = []
    first_heartbeat = asyncio.Event()
    provider = RecordingMock()

    async def waiting(*_):
        await asyncio.Event().wait()

    def observe(kind, message, details):
        events.append((kind, message, details))
        if kind == 'model_wait':
            first_heartbeat.set()

    provider.chat = waiting
    before = asyncio.all_tasks()
    running = asyncio.create_task(run(GradingService(config(tmp_path), provider, observer=observe)))
    await asyncio.wait_for(first_heartbeat.wait(), timeout=3)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert provider.closed
    assert asyncio.all_tasks() == before
    assert any(kind == 'model_wait' and details['elapsed_seconds'] >= 1 for kind, _, details in events)
    assert events[-1] == ('cancelled', 'Проверка остановлена', {'code': 'cancelled'})


async def test_error_event_contains_only_structured_code(tmp_path):
    events = []
    provider = RecordingMock()
    provider.chat = AsyncMock(side_effect=LLMError('private-test-key upstream private response'))
    with pytest.raises(LLMError):
        await run(GradingService(config(tmp_path), provider, observer=lambda *event: events.append(event)))
    assert events[-1] == ('error', 'Проверка завершилась ошибкой', {'code': 'llm_error'})
    assert 'private' not in json.dumps(events)
    assert provider.closed


def test_file_diagnostics_are_bounded_and_redact_configured_secret_and_image(tmp_path):
    service = GradingService(config(tmp_path), MockProvider())
    text = service._event_text('private-test-key data:image/jpeg;base64,cHJpdmF0ZQ== ' + 'я' * 96000)
    assert 'private-test-key' not in text and 'cHJpdmF0ZQ' not in text
    assert '[ключ скрыт]' in text and '[изображение скрыто]' in text
    assert len(text.encode('utf-8')) <= 96000
    assert service._tool_details({'name': 'secret-unknown-tool'}, {'path': '/private/secret'}) == {'tool': 'unknown'}


async def test_direct_provider_ignores_environment_proxy_and_disables_redirects(monkeypatch):
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:1')
    settings = SimpleNamespace(api_key='test-key', base_url='https://provider.invalid', timeout_s=360)
    provider = Provider(settings, trust_env=False)
    try:
        assert provider.client._client._trust_env is False
        assert provider.client._client.follow_redirects is False
        assert not provider.client._client._mounts
    finally:
        await provider.close()


def test_default_provider_keeps_sdk_transport_defaults(monkeypatch):
    captured = {}
    monkeypatch.setattr('app.grading.provider.AsyncOpenAI', lambda **kwargs: captured.update(kwargs))
    Provider(SimpleNamespace(api_key='test-key', base_url='https://provider.invalid', timeout_s=360))
    assert 'http_client' not in captured
    assert captured['max_retries'] == 0
