"""Portable app integrations use local files and never send a model request."""
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.grading.package import package_paths
from app.grading.provider import MockProvider
from app.local.launcher import (CONFIG_END, CONFIG_START, DIRECT_URL, EventStore, LocalConfig,
                                create_local_app, executable_config, load_config, make_settings)


SECRET = 'local-private-api-key'
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def workspace(tmp_path):
    destination = tmp_path / 'portable'
    for name, source in package_paths().items():
        group = 'common' if source.parent.parent.name == 'common' else '16'
        path = destination / 'prompts' / group / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(source.read_bytes())
    return destination


def uploads(payload=None):
    stream = BytesIO()
    Image.new('RGB', (24, 24), 'white').save(stream, 'PNG')
    image = stream.getvalue()
    return [('task_image', ('task.png', image, 'image/png')),
            ('solution_images', ('solution.png', image if payload is None else payload, 'image/png'))]


def trailer(values):
    raw = json.dumps(values).encode('utf-8')
    return b'fake executable prefix' + CONFIG_START + raw + len(raw).to_bytes(8, 'big') + CONFIG_END


def test_config_and_settings_ignore_gateway_environment_and_dotenv(workspace, monkeypatch):
    monkeypatch.chdir(workspace)
    (workspace / '.env').write_text('LLM_BASE_URL=https://gateway.invalid\nLLM_API_KEY=gateway-key\n', encoding='utf-8')
    for key, value in {
        'LLM_BASE_URL': 'https://gateway.invalid', 'LLM_API_KEY': 'gateway-key',
        'LLM_MODEL': 'gateway-model', 'LLM_EXTRA_BODY': '{"gateway":true}',
        'LLM_VISION_BASE_URL': 'https://gateway.invalid', 'LLM_VISION_API_KEY': 'vision-key',
        'APP_ENV': 'prod', 'APP_HOST': '0.0.0.0', 'APP_PROMPTS_DIR': '/private/server/prompts',
        'DEBUG_ENABLED': 'true', 'DEBUG_TOKEN': 'gateway-debug',
        'INTERNAL_GRADING_ENABLED': 'true', 'INTERNAL_GRADING_TOKEN': 'gateway-internal',
        'PHOTO_REPORTS_DIR': '/private/server/reports', 'FEATURES': '{"solve_independently":false}',
        'BOTAI_LOCAL_API_KEY': SECRET,
    }.items():
        monkeypatch.setenv(key, value)
    config = load_config(workspace)
    assert not config.api_key.get_secret_value()
    settings = make_settings(workspace, LocalConfig(api_key=SECRET), mock=False)
    assert settings.llm.api_key == SECRET and settings.llm.base_url == DIRECT_URL
    assert settings.llm.model == config.model and settings.llm.extra_body is None
    assert settings.vision.base_url is None and settings.vision.api_key is None
    assert settings.app.env == 'local' and settings.app.host == '127.0.0.1'
    assert settings.app.prompts_dir == '' and settings.app.cors_origins == ''
    assert not settings.debug.enabled and not settings.internal_grading.enabled
    assert settings.debug.token is None and settings.internal_grading.token is None
    assert settings.features.features is None
    assert settings.photo.reports_dir == str(workspace / 'data' / 'local-reports')


@pytest.mark.parametrize('variable', ['LLM_EXTRA_BODY', 'FEATURES'])
def test_malformed_unrelated_environment_does_not_break_settings(workspace, monkeypatch, variable):
    monkeypatch.setenv(variable, 'not valid JSON')
    settings = make_settings(workspace, LocalConfig(), mock=True)
    assert settings.llm.provider == 'mock'
    assert settings.features.features is None


@pytest.mark.parametrize('endpoint', ['https://gateway.invalid', 'http://api.deepseek.com/v1',
                                     'https://api.deepseek.com.evil.test/v1',
                                     'https://user:secret@api.deepseek.com/v1'])
def test_public_configuration_cannot_redirect_to_gateway(workspace, endpoint):
    (workspace / 'botai-local.json').write_text(json.dumps({'base_url': endpoint}), encoding='utf-8')
    with pytest.raises(ValueError, match='direct DeepSeek'):
        load_config(workspace)


def test_public_config_has_no_key_and_direct_url_normalizes(workspace, monkeypatch):
    monkeypatch.delenv('BOTAI_LOCAL_API_KEY', raising=False)
    public = workspace / 'botai-local.json'
    public.write_text(json.dumps({'api_key': SECRET}), encoding='utf-8')
    with pytest.raises(ValueError, match='public settings'):
        load_config(workspace)
    public.write_text(json.dumps({'base_url': 'https://api.deepseek.com/', 'model': 'local-model'}), encoding='utf-8')
    config = load_config(workspace)
    assert config.base_url == DIRECT_URL and config.model == 'local-model'
    assert not config.api_key.get_secret_value()


def test_mock_roundtrip_external_workspace_from_another_cwd(workspace, tmp_path, monkeypatch):
    other = tmp_path / 'elsewhere'
    other.mkdir()
    monkeypatch.chdir(other)
    app = create_local_app(workspace, LocalConfig(api_key=SECRET), mock=True)
    with TestClient(app, base_url='http://127.0.0.1:8765') as client:
        assert client.get('/ui/?local=1').status_code == 200
        assert client.get('/ui/local.js').status_code == 200
        status = client.get('/local/status')
        assert status.status_code == 200
        assert status.json()['workspace'] == str(workspace.resolve())
        assert status.json()['endpoint'] == DIRECT_URL and status.json()['mode'] == 'mock'
        assert SECRET not in status.text
        assert all(Path(path).is_relative_to(workspace) for path in status.json()['prompt_files'].values())
        response = client.post('/api/v1/photo-check', files=uploads(), headers={'X-Request-ID': 'local-run-123'})
        assert response.status_code == 200, response.text
        assert response.json()['grading']['score'] == 2
        assert response.headers['X-Request-ID'] == 'local-run-123'
        assert response.headers['Cache-Control'] == 'no-store'
        events = client.get('/local/events').json()
        run_events = [event for event in events['events'] if event['kind'] != 'ready']
        assert all(event['request_id'] == 'local-run-123' for event in run_events)
        assert run_events[-1]['kind'] == 'http_complete'
        assert run_events[-1]['details']['http_status'] == 200
        writes = [event['details']['content'] for event in run_events
                  if event['kind'] == 'tool_result' and event['details'].get('path') == 'response.json'
                  and event['details']['tool'] == 'write_file']
        assert writes == [response.text]
        assert client.get('/local/events', params={'after': events['cursor']}).json()['events'] == []
        log = client.get('/local/log.txt')
        assert log.status_code == 200 and 'attachment' in log.headers['Content-Disposition']
        assert SECRET not in log.text and 'base64,' not in log.text
        assert not (other / 'data').exists()
    assert (workspace / 'data' / 'local-reports' / '.identity-secret').is_file()


def test_validation_failure_logs_http_status_and_request_id(workspace):
    app = create_local_app(workspace, LocalConfig(), mock=True)
    with TestClient(app, base_url='http://localhost:8765') as client:
        response = client.post('/api/v1/photo-check', files=uploads(b'not an image'))
        assert response.status_code == 422 and 'grading' not in response.json()
        event = client.get('/local/events').json()['events'][-1]
        assert event['kind'] == 'http_complete' and event['details']['http_status'] == 422
        assert event['request_id'] == response.headers['X-Request-ID']
        assert app.state.photo_active == 0


def test_external_catalog_is_required_at_start_and_used_for_each_run(workspace):
    catalog = workspace / 'prompts' / '16' / 'popular_mistakes.md'
    original = catalog.read_text(encoding='utf-8')
    catalog.write_text('No error-code table', encoding='utf-8')
    with pytest.raises(ValueError, match='error-code rows'):
        create_local_app(workspace, LocalConfig(), mock=True)
    catalog.write_text(original, encoding='utf-8')
    app = create_local_app(workspace, LocalConfig(), mock=True)
    with TestClient(app, base_url='http://127.0.0.1') as client:
        catalog.write_text('No error-code table', encoding='utf-8')
        response = client.post('/api/v1/photo-check', files=uploads())
        assert response.status_code == 502 and 'grading' not in response.json()
        events = client.get('/local/events').json()['events']
        assert any(event['kind'] == 'validation' and event['details'].get('valid') is False for event in events)


def test_private_key_is_redacted_from_explicit_file_data(workspace):
    class KeyInTaskMock(MockProvider):
        async def chat(self, messages, tools=None):
            response = await super().chat(messages, tools)
            if not tools:
                value = json.loads(response['content'])
                value['statement'] += ' ' + SECRET
                response['content'] = json.dumps(value, ensure_ascii=False)
            return response

    app = create_local_app(workspace, LocalConfig(api_key=SECRET), mock=True)
    original = app.state.photo_service_factory

    def factory(settings):
        service = original(settings)
        service.provider = KeyInTaskMock()
        return service

    app.state.photo_service_factory = factory
    with TestClient(app, base_url='http://127.0.0.1') as client:
        response = client.post('/api/v1/photo-check', files=uploads())
        assert response.status_code == 200
        assert SECRET in response.json()['task']['statement']
        assert SECRET not in client.get('/local/status').text
        assert SECRET not in client.get('/local/events').text
        assert SECRET not in client.get('/local/log.txt').text


def test_host_origin_and_hidden_route_boundaries(workspace):
    app = create_local_app(workspace, LocalConfig(), mock=True)
    with TestClient(app, base_url='http://127.0.0.1:8765') as client:
        assert client.get('/local/status', headers={'Host': 'attacker.example'}).status_code == 400
        for origin in ['https://attacker.example', 'null', 'http://127.0.0.1:1234']:
            result = client.get('/local/status', headers={'Origin': origin})
            assert result.status_code == 403
            assert result.headers['X-Request-ID']
        assert client.get('/local/status', headers={'Origin': 'http://127.0.0.1:8765'}).status_code == 200
        for path in ['/debug/config', '/internal/v1/grading/capabilities', '/api/v1/tasks',
                     '/api/v1/grade', '/api/v1/photo/grade', '/openapi.json', '/docs', '/ready']:
            result = client.get(path)
            assert result.status_code == 404, path
            assert result.headers['X-Request-ID']
        assert client.get('/local/events?after=-1').status_code == 422


def test_signed_executable_trailer_and_frozen_key_isolation(workspace, tmp_path, monkeypatch):
    executable = tmp_path / 'BotAI-Local'
    values = {'api_key': SECRET, 'model': 'embedded-model', 'base_url': DIRECT_URL}
    executable.write_bytes(trailer(values) + b'macOS signature' * 500)
    assert executable_config(executable) == values
    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    monkeypatch.setattr(sys, 'executable', str(executable))
    monkeypatch.setenv('BOTAI_LOCAL_API_KEY', 'different-source-development-key')
    (workspace / 'botai-local.json').write_text('{"model":"public-model"}', encoding='utf-8')
    config = load_config(workspace)
    assert config.api_key.get_secret_value() == SECRET and config.model == 'public-model'


@pytest.mark.parametrize('payload', [CONFIG_END, b'prefix' + (999999).to_bytes(8, 'big') + CONFIG_END,
                                    b'not-start-mark' + b'{}' + (2).to_bytes(8, 'big') + CONFIG_END])
def test_malformed_executable_footer_is_rejected(tmp_path, payload):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(payload)
    with pytest.raises(ValueError):
        executable_config(executable)


@pytest.mark.parametrize('values', [None, [], 'not an object'])
def test_embedded_configuration_must_be_an_object(tmp_path, values):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(trailer(values))
    with pytest.raises(ValueError):
        executable_config(executable)


def test_event_store_redacts_secret_even_when_json_escaped():
    secret = 'private"key\\with\nescaping'
    store = EventStore(secret)
    store.emit('tool_result', 'Saved ' + secret, {'content': 'prefix ' + secret + ' suffix'})
    event = store.read()['events'][0]
    assert secret not in event['message']
    assert secret not in event['details']['content']
    assert '[REDACTED]' in event['message']


def test_fresh_process_never_initializes_server_environment(workspace, tmp_path):
    other = tmp_path / 'different-cwd'
    other.mkdir()
    (other / '.env').write_text('APP_ENV=not-a-server-environment\nLLM_PROVIDER=invalid\n', encoding='utf-8')
    environment = dict(os.environ)
    environment['PYTHONPATH'] = str(ROOT)
    environment['APP_ENV'] = 'invalid-inherited-server-environment'
    environment['LLM_EXTRA_BODY'] = 'invalid server JSON'
    script = ('from pathlib import Path; from app.local.launcher import LocalConfig, create_local_app; '
              'import sys; app = create_local_app(Path(sys.argv[1]), LocalConfig(), mock=True); '
              'assert app.state.settings.llm.provider == "mock"')
    result = subprocess.run([sys.executable, '-c', script, str(workspace)], cwd=other,
                            env=environment, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
