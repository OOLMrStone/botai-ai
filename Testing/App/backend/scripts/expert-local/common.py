"""HTTP and DB helpers restricted to the separate expert-local fixture."""
import http.cookiejar
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / 'runtime/expert-local'
COMPOSE = str(ROOT / 'scripts/expert-local/compose.sh')
BASE_URL = 'http://127.0.0.1:18085'

def credentials():
    if (RUNTIME / 'ISOLATED_EXPERT_LOCAL').read_text().strip() != 'botai-expert-local':
        raise RuntimeError('Isolated expert marker required')
    data = json.loads((RUNTIME / 'credentials.json').read_text())
    for account in data['accounts'].values():
        if not account['email'].endswith('@expert-local.botai.example'):
            raise RuntimeError('Only synthetic expert-local accounts allowed')
    return data['accounts']

def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def db(sql, query=False):
    command = [COMPOSE, 'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'botai_migrator', '-d', 'botai_expert_local', '-At']
    actual = subprocess.check_output(command, input=b'SELECT current_database();', stderr=subprocess.DEVNULL).decode().strip()
    if actual != 'botai_expert_local':
        raise RuntimeError('Refusing fixture mutation of unexpected database')
    result = subprocess.run(command, input=sql.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError('Expert-local DB operation failed (details deliberately withheld)')
    return result.stdout.decode().strip() if query else None

class Client:
    def __init__(self, name=None, login=True):
        self.name = name or 'anonymous'
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.request('GET', '/api/auth/csrf')
        if name and login:
            self.request('POST', '/api/auth/login', credentials()[name])
            self.request('GET', '/api/auth/csrf')

    def request(self, method, path, body=None, expected=200, headers=None, csrf=True, raw=False):
        headers = dict(headers or {})
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
            headers['Content-Type'] = 'application/json'
        if method not in ('GET', 'HEAD') and csrf:
            headers['X-XSRF-TOKEN'] = next(cookie.value for cookie in self.jar if cookie.name == 'XSRF-TOKEN')
        request = urllib.request.Request(BASE_URL + path, body, headers, method=method)
        try:
            with self.opener.open(request, timeout=25) as response:
                status, data, response_headers = response.status, response.read(), dict(response.headers.items())
        except urllib.error.HTTPError as error:
            status, data, response_headers = error.code, error.read(), dict(error.headers.items())
        if status != expected:
            # Never put payloads, credentials or private student data into CI/log output.
            try:
                code = json.loads(data).get('code', 'unknown')
            except Exception:
                code = 'non-json'
            raise AssertionError(f'{self.name}: {method} {path} expected {expected}, got {status} ({code})')
        return (data, response_headers) if raw else (json.loads(data) if data else None)
