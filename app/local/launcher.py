"""Run the existing photo form and grading pipeline directly on this computer."""
from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import socket
import sys
import threading
import webbrowser

from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError
from fastapi import Query, Request

from app.config import (AppSettings, DebugSettings, FeatureSettings, GradingSettings,
                        InternalGradingSettings, LLMSettings, PhotoSettings, Settings,
                        VisionOverrides)
from app.core.context import get_request_id, new_id
from app.grading.package import load_package, package_paths
from app.grading.validator import load_error_codes

DIRECT_URL = 'https://api.deepseek.com/v1'
CONFIG_END = b'BOTAI_LOCAL_CONFIG_END\n'
CONFIG_START = b'\nBOTAI_LOCAL_CONFIG_V1\n'


class LocalConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    api_key: SecretStr = SecretStr('')
    model: str = Field(default='deepseek-v4-flash', min_length=1, max_length=128)
    base_url: str = DIRECT_URL
    timeout_seconds: float = Field(default=360, gt=0, le=360)
    max_output_tokens: int = Field(default=16000, ge=8000, le=65536)
    extra_body: dict | None = None


def executable_config(executable: Path) -> dict:
    """Read config from the final executable only, including after macOS signing.

    A signature may follow our trailer. No secret sidecar or unpacked resource
    is used, so PyInstaller never extracts credentials to its temporary folder.
    """
    with executable.open('rb') as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - 4 * 1024 * 1024))
        tail = stream.read()
    end = tail.rfind(CONFIG_END)
    if end < 0:
        return {}
    if end < 8:
        raise ValueError('Invalid embedded configuration')
    size = int.from_bytes(tail[end - 8:end], 'big')
    start = end - 8 - size
    if not 0 < size <= 65536 or start < len(CONFIG_START):
        raise ValueError('Invalid embedded configuration')
    if tail[start - len(CONFIG_START):start] != CONFIG_START:
        raise ValueError('Invalid embedded configuration')
    value = json.loads(tail[start:end - 8])
    if not isinstance(value, dict):
        raise ValueError('Invalid embedded configuration')
    return value


def load_config(workspace: Path) -> LocalConfig:
    values = executable_config(Path(sys.executable)) if getattr(sys, 'frozen', False) else {}
    config_file = workspace / 'botai-local.json'
    if config_file.exists():
        public = json.loads(config_file.read_text(encoding='utf-8'))
        if not isinstance(public, dict) or 'api_key' in public:
            raise ValueError('botai-local.json accepts public settings only; no API key')
        values.update(public)
    # Never load the repository .env, shell API keys, or a gateway token.
    config = LocalConfig.model_validate(values)
    if config.base_url.rstrip('/') not in {'https://api.deepseek.com', DIRECT_URL}:
        raise ValueError('Local app only supports the direct DeepSeek endpoint')
    return config.model_copy(update={'base_url': DIRECT_URL})


def isolated_settings(settings_type, **overrides):
    """Explicit defaults outrank environment variables; .env is never opened."""
    values = {field.alias or name: field.get_default(call_default_factory=True)
              for name, field in settings_type.model_fields.items()}
    values.update(overrides)
    return settings_type(_env_file=None, **values)


def make_settings(workspace: Path, config: LocalConfig, mock: bool) -> Settings:
    return Settings(
        app=isolated_settings(AppSettings, host='127.0.0.1', cors_origins=''),
        llm=isolated_settings(LLMSettings, provider='mock' if mock else 'openai',
                             api_key=config.api_key.get_secret_value(), base_url=DIRECT_URL,
                             model=config.model, timeout_s=config.timeout_seconds,
                             max_output_tokens=config.max_output_tokens,
                             max_retries=0, extra_body=config.extra_body),
        vision=isolated_settings(VisionOverrides, provider='mock' if mock else 'openai'),
        grading=isolated_settings(GradingSettings),
        debug=isolated_settings(DebugSettings, enabled=False),
        features=isolated_settings(FeatureSettings),
        photo=isolated_settings(PhotoSettings, concurrency=1,
                               reports_dir=str(workspace / 'data' / 'local-reports')),
        internal_grading=isolated_settings(InternalGradingSettings, enabled=False),
    )


class EventStore:
    """Bounded, private in-memory trace; exporting is a user action."""
    def __init__(self, secret: str = ''):
        self.events = deque()
        self.seq = 0
        self.size = 0
        self.secret = secret
        self.lock = threading.Lock()

    def emit(self, kind: str, message: str, details: dict | None = None):
        event = {'time': datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
                 'request_id': get_request_id() or (details or {}).get('request_id') or '-', 'kind': kind,
                 'message': message, 'details': details}
        raw = json.dumps(event, ensure_ascii=False)
        if self.secret:
            raw = raw.replace(json.dumps(self.secret, ensure_ascii=False)[1:-1], '[REDACTED]')
        event = json.loads(raw)
        if len(raw) > 120000:
            event['details'] = {'truncated': True, 'note': 'Event details exceeded the display limit'}
            raw = json.dumps(event, ensure_ascii=False)
        with self.lock:
            self.seq += 1
            event['seq'] = self.seq
            self.events.append((event, len(raw)))
            self.size += len(raw)
            while len(self.events) > 2000 or self.size > 8 * 1024 * 1024:
                self.size -= self.events.popleft()[1]
        # Human content and credentials are not sent to process logs.
        if kind != 'model_wait':
            logging.getLogger(__name__).info('local event: %s', kind)

    def read(self, after: int = 0) -> dict:
        with self.lock:
            return {'events': [event for event, _ in self.events if event['seq'] > after],
                    'cursor': self.seq}


def create_local_app(workspace: Path, config: LocalConfig, *, mock: bool = False):
    from fastapi.responses import JSONResponse, PlainTextResponse
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    from app.grading.provider import MockProvider, Provider
    from app.grading.service import GradingService
    from app.application import create_app

    workspace = workspace.resolve()
    # Fail before accepting work if any approved file is missing or malformed.
    static = Path(__file__).resolve().parents[1] / 'static'
    for name in ('index.html', 'local.js', 'local.css'):
        if not (static / name).is_file():
            raise FileNotFoundError('Missing local application asset: ' + name)
    load_package(root=workspace)
    paths = package_paths(root=workspace)
    load_error_codes(paths['popular_mistakes.md'])
    settings = make_settings(workspace, config, mock)
    app = create_app(settings, ephemeral_identity=True)
    events = EventStore(config.api_key.get_secret_value())
    app.state.local_events = events

    def service_factory(current):
        # Load prompts before creating a network client, including on each new run.
        service = GradingService(current, package_root=workspace, observer=events.emit)
        service.provider = MockProvider() if mock else Provider(current.llm, trust_env=False)
        return service

    app.state.photo_service_factory = service_factory
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost'])

    @app.middleware('http')
    async def local_boundary(request: Request, call_next):
        path = request.url.path
        origin = request.headers.get('origin')
        if (origin is not None and origin != str(request.base_url).rstrip('/')):
            return JSONResponse({'error': {'code': 'local_origin_required',
                                'message': 'Открой форму в окне локального приложения'}},
                                status_code=403, headers={'X-Request-ID': new_id()})
        allowed = (path in {'/', '/health', '/api/v1/photo-check', '/api/v1/photo-check/config',
                            '/local/status', '/local/events', '/local/log.txt'} or path.startswith('/ui/'))
        if not allowed:
            return JSONResponse({'error': {'code': 'not_found', 'message': 'Нет такого маршрута'}},
                                status_code=404, headers={'X-Request-ID': new_id()})
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Content-Security-Policy'] = "frame-ancestors 'none'"
        if path == '/api/v1/photo-check' and request.method == 'POST':
            events.emit('http_complete', 'Запрос завершён',
                        {'http_status': response.status_code,
                         'request_id': response.headers.get('X-Request-ID', '-')})
        return response

    @app.get('/local/status')
    async def status():
        return {'mode': settings.llm.provider, 'model': settings.llm.model,
                'endpoint': DIRECT_URL, 'workspace': str(workspace),
                'key_configured': bool(config.api_key.get_secret_value()),
                'prompt_files': {name: str(path) for name, path in paths.items()}}

    @app.get('/local/events')
    async def get_events(after: int = Query(default=0, ge=0)):
        return events.read(after)

    @app.get('/local/log.txt')
    async def get_log():
        lines = [json.dumps(item, ensure_ascii=False) for item in events.read()['events']]
        return PlainTextResponse('\n'.join(lines) + '\n', headers={
            'Content-Disposition': 'attachment; filename="botai-local-log.txt"'})

    events.emit('ready', 'Локальный сервис готов',
                {'mode': settings.llm.provider, 'endpoint': DIRECT_URL, 'model': config.model})
    return app


def default_workspace() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='BotAI: local files, direct DeepSeek API')
    parser.add_argument('--workspace', type=Path, default=default_workspace())
    parser.add_argument('--mock', action='store_true', help='Offline demonstration; no model charges')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=0, help='Local port; 0 chooses an available port')
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    try:
        workspace = args.workspace.expanduser().resolve(strict=True)
        config = load_config(workspace)
        if not args.mock and not config.api_key.get_secret_value():
            print('В этой сборке нет ключа DeepSeek. Для демо запусти с --mock.', file=sys.stderr)
            return 1
        app = create_local_app(workspace, config, mock=args.mock)
        import uvicorn

        class LocalServer(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets=sockets)
                if self.started:
                    print(f'BotAI Local: {url}', flush=True)
                    print('Stop: Ctrl+C', flush=True)
                    if not args.no_browser:
                        webbrowser.open(url)

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(('127.0.0.1', args.port))
            url = f'http://127.0.0.1:{sock.getsockname()[1]}/ui/?local=1'
            server = LocalServer(uvicorn.Config(app, host='127.0.0.1', port=sock.getsockname()[1],
                                               loop='asyncio', http='h11', ws='none',
                                               proxy_headers=False, access_log=False, log_config=None))
            server.run(sockets=[sock])
        return 0
    except (OSError, ValueError, ValidationError):
        # ValidationError/raw exceptions may include secret input values.
        print('Не удалось запустить приложение. Проверь папку промптов, настройки и доступ к папке data.',
              file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
