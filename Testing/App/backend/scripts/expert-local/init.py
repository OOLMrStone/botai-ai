#!/usr/bin/env python3
"""Generate private local credentials once; keep existing demos intact."""
import json
import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / 'runtime/expert-local'
RUNTIME.mkdir(mode=0o700, parents=True, exist_ok=True)
RUNTIME.chmod(0o700)

def private_file(path, content):
    if not path.exists():
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
    path.chmod(0o600)

env = RUNTIME / '.env'
values = {key: secrets.token_hex(32) for key in (
    'POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'OPS_DB_PASSWORD',
    'GARAGE_RPC_SECRET', 'S3_SECRET_KEY', 'AI_SERVICE_TOKEN')}
values['S3_ACCESS_KEY'] = 'GK' + secrets.token_hex(16)
values['FRONTEND_BASE_URL'] = 'http://localhost:13003'
private_file(env, ''.join(f'{key}={value}\n' for key, value in values.items()))
values = dict(line.split('=', 1) for line in env.read_text().splitlines() if line and not line.startswith('#'))
private_file(RUNTIME / 'garage.toml', f'''metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "{values['GARAGE_RPC_SECRET']}"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
''')
accounts = {name: {'email': f'{name}@expert-local.botai.example', 'password': secrets.token_urlsafe(24)}
            for name in ('expert', 'same_school_expert', 'other_expert', 'student', 'second_student', 'other_student')}
private_file(RUNTIME / 'credentials.json', json.dumps({'environment': 'isolated expert local only', 'accounts': accounts}, ensure_ascii=False, indent=2) + '\n')
private_file(RUNTIME / 'ISOLATED_EXPERT_LOCAL', 'botai-expert-local\n')
print('Private expert-local files prepared; existing files preserved. Credentials: runtime/expert-local/credentials.json')
