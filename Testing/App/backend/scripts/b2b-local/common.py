"""Helpers pinned to the isolated B2B sandbox, never a shared runtime."""
import hashlib
import json
import os
import subprocess
import http.cookiejar
import urllib.error
import urllib.request
import uuid
import shlex
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
INSTANCE = os.environ.get('B2B_LOCAL_INSTANCE', 'default')
PROFILES = {
    'default': ('botai-b2b-local', 'runtime/b2b-local', 13004, 18086, 18027),
    'partner-check': ('botai-b2b-local-partner-check', 'runtime/b2b-local-partner-check', 13014, 18096, 18037),
}
if INSTANCE not in PROFILES:
    raise RuntimeError('B2B_LOCAL_INSTANCE must be default or partner-check')
PROJECT, RUNTIME_RELATIVE, FRONTEND_PORT, API_PORT, MAIL_PORT = PROFILES[INSTANCE]
RUNTIME = ROOT / RUNTIME_RELATIVE
FRONTEND_URL = f'http://student.localhost:{FRONTEND_PORT}'
DATABASE = 'botai_b2b_local'
COMPOSE = ROOT / 'scripts/b2b-local/compose.sh'
BASE_URL = f'http://127.0.0.1:{API_PORT}'
FIXTURE_NAMESPACE = uuid.UUID('65b74f60-b245-49e4-9321-bd629d15b731')


def private_file(path, content):
    """Create once without following symlinks or replacing existing credentials."""
    if path.is_symlink():
        raise RuntimeError('Private runtime symlinks are forbidden')
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        if not path.is_file():
            raise RuntimeError('Expected a private runtime file')
        path.chmod(0o600)
        return False
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write(content)
    return True


def assert_isolated():
    marker = RUNTIME / 'ISOLATED_B2B_LOCAL'
    if RUNTIME.is_symlink() or marker.is_symlink() or marker.read_text().strip() != PROJECT:
        raise RuntimeError('Isolated B2B marker required')


def assert_local_docker():
    override = os.environ.get('DOCKER_HOST', '')
    if override and not override.startswith('unix://'):
        raise RuntimeError('B2B demo requires a local Unix Docker socket')
    endpoint = subprocess.check_output(['docker', 'context', 'inspect', '--format',
        '{{(index .Endpoints "docker").Host}}'], text=True).strip()
    if not endpoint.startswith('unix://'):
        raise RuntimeError('B2B demo requires a local Unix Docker context')


def credentials():
    assert_isolated()
    path = RUNTIME / 'credentials.json'
    if path.is_symlink():
        raise RuntimeError('Private credentials symlinks are forbidden')
    accounts = json.loads(path.read_text())['accounts']
    expected = {'student': 'alexey.smirnov@math.example', 'expert': 'maria.orlova@math.example'}
    if set(accounts) != set(expected) or any(accounts[name]['email'] != email for name, email in expected.items()):
        raise RuntimeError('Only the two synthetic B2B accounts are allowed')
    return accounts


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def db(sql, query=False):
    assert_isolated()
    command = [str(COMPOSE), 'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1',
               '-U', 'botai_migrator', '-d', DATABASE, '-At']
    current = subprocess.check_output(command, input=b'SELECT current_database();',
                                      stderr=subprocess.DEVNULL).decode().strip()
    if current != DATABASE:
        raise RuntimeError('Refusing unexpected database')
    result = subprocess.run(command, input=sql.encode(), capture_output=True)
    if result.returncode:
        raise RuntimeError('B2B DB operation failed; private details withheld')
    return result.stdout.decode().strip() if query else None


class Client:
    def __init__(self, name=None):
        self.name = name or 'anonymous'
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                                  urllib.request.HTTPCookieProcessor(self.jar))
        self.request('GET', '/api/auth/csrf')
        if name:
            self.request('POST', '/api/auth/login', credentials()[name])
            self.request('GET', '/api/auth/csrf')

    def request(self, method, path, body=None, expected=200, headers=None, csrf=True, raw=False):
        if not path.startswith('/api/') or '://' in path:
            raise RuntimeError('Only fixed local API paths are allowed')
        headers = dict(headers or {})
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
            headers['Content-Type'] = 'application/json'
        if method not in ('GET', 'HEAD') and csrf:
            headers['X-XSRF-TOKEN'] = next(cookie.value for cookie in self.jar if cookie.name == 'XSRF-TOKEN')
        request = urllib.request.Request(BASE_URL + path, body, headers, method=method)
        try:
            with self.opener.open(request, timeout=30) as response:
                status, data, response_headers = response.status, response.read(), dict(response.headers.items())
        except urllib.error.HTTPError as error:
            status, data, response_headers = error.code, error.read(), dict(error.headers.items())
        allowed = expected if isinstance(expected, tuple) else (expected,)
        if status not in allowed:
            try:
                code = json.loads(data).get('code', 'unknown')
            except Exception:
                code = 'non-json'
            raise AssertionError(f'{self.name}: {method} API request expected {allowed}, got {status} ({code})')
        return (data, response_headers) if raw else (json.loads(data) if data else None)


def verify_export(directory):
    """Verify every payload byte and reject undeclared files and unsafe paths."""
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError('Expected a private AI export directory')
    manifest_path = directory / 'manifest.json'
    if manifest_path.is_symlink():
        raise RuntimeError('AI manifest symlink forbidden')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('schema_version') != 1 or manifest.get('algorithm') != 'sha256':
        raise RuntimeError('Unsupported AI export manifest')
    files = manifest.get('files')
    if not isinstance(files, dict) or not files or not {'Dockerfile', 'requirements.txt'}.issubset(files):
        raise RuntimeError('Incomplete AI export manifest')
    for relative, expected in files.items():
        if not isinstance(relative, str):
            raise RuntimeError('Unsafe AI manifest path')
        parts = PurePosixPath(relative)
        if (parts.is_absolute() or '..' in parts.parts
                or str(parts) != relative or '\\' in relative or relative == 'manifest.json'):
            raise RuntimeError('Unsafe AI manifest path')
        path = directory / relative
        if (path.is_symlink() or not path.is_file() or directory.resolve() not in path.resolve().parents
                or not isinstance(expected, str) or hashlib.sha256(path.read_bytes()).hexdigest() != expected):
            raise RuntimeError('AI export integrity failure')
    actual = set()
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise RuntimeError('AI export symlink forbidden')
        if path.is_file():
            actual.add(path.relative_to(directory).as_posix())
    if actual != set(files) | {'manifest.json'}:
        raise RuntimeError('Undeclared AI export files')
    return hashlib.sha256(manifest_path.read_bytes()).hexdigest()


if __name__ == '__main__':
    if sys.argv[1:] != ['--shell-profile']:
        raise SystemExit('Only --shell-profile is supported')
    # Fixed allowlisted values only; compose.sh uses these rather than inherited overrides.
    for key, value in {'B2B_PROJECT': PROJECT, 'B2B_RUNTIME_DIR': RUNTIME_RELATIVE,
                       'B2B_FRONTEND_PORT': FRONTEND_PORT, 'B2B_API_PORT': API_PORT,
                       'B2B_MAIL_PORT': MAIL_PORT}.items():
        print('export ' + key + '=' + shlex.quote(str(value)))
