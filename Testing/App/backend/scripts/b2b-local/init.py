#!/usr/bin/env python3
"""Create this sandbox's private credentials once; preserve all existing data."""
import json
import os
import secrets
from common import RUNTIME, PROJECT, FRONTEND_URL, private_file

if RUNTIME.is_symlink():
    raise SystemExit('Runtime directory symlink forbidden')
RUNTIME.mkdir(mode=0o700, parents=True, exist_ok=True)
RUNTIME.chmod(0o700)
marker = RUNTIME / 'ISOLATED_B2B_LOCAL'
if marker.exists() and (marker.is_symlink() or marker.read_text().strip() != PROJECT):
    raise SystemExit('Unexpected sandbox marker; existing files preserved')
private_file(marker, PROJECT + '\n')
values = {key: secrets.token_hex(32) for key in (
    'POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'OPS_DB_PASSWORD',
    'GARAGE_RPC_SECRET', 'S3_SECRET_KEY', 'AI_SERVICE_TOKEN')}
values.update(S3_ACCESS_KEY='GK' + secrets.token_hex(16),
              FRONTEND_BASE_URL=FRONTEND_URL,
              B2B_SEED_UID=str(os.getuid()),
              APP_B2B_OPERATOR_USER_IDS='')
env = RUNTIME / '.env'
private_file(env, ''.join(f'{key}={value}\n' for key, value in values.items()))
values = dict(line.split('=', 1) for line in env.read_text().splitlines()
              if line and not line.startswith('#'))
if 'B2B_SEED_UID' not in values:
    # Add only the newly introduced nonsecret operator UID; existing credentials stay byte-for-byte.
    with env.open('a') as stream:
        stream.write('B2B_SEED_UID=' + str(os.getuid()) + '\n')
    values['B2B_SEED_UID'] = str(os.getuid())
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
emails = {'student': 'alexey.smirnov@math.example', 'expert': 'maria.orlova@math.example'}
accounts = {name: {'email': emails[name],
                   'password': secrets.token_urlsafe(24)} for name in ('student', 'expert')}
private_file(RUNTIME / 'credentials.json', json.dumps(
    {'environment': 'isolated B2B local only', 'accounts': accounts}, indent=2) + '\n')
print('B2B private runtime prepared; existing credentials preserved. No services started.')
