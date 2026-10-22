#!/usr/bin/env python3
"""Generate isolated mock credentials once; never print secret values."""
import json, os, secrets
from pathlib import Path
root = Path(__file__).resolve().parents[2]
runtime = root / 'runtime'
runtime.mkdir(exist_ok=True)
env = runtime / '.env.integration'
if not env.exists():
    values = dict(POSTGRES_PASSWORD=secrets.token_hex(24), APP_DB_PASSWORD=secrets.token_hex(24),
                  OPS_DB_PASSWORD=secrets.token_hex(24), GARAGE_RPC_SECRET=secrets.token_hex(32),
                  S3_ACCESS_KEY='GK'+secrets.token_hex(16), S3_SECRET_KEY=secrets.token_hex(32),
                  AI_SERVICE_TOKEN=secrets.token_hex(32), COMPOSE_PROJECT_NAME='botai-integration-local',
                  FRONT_CONTEXT='../botai-front', AI_CONTEXT=str(runtime / 'ai-export'), FRONTEND_BASE_URL='http://127.0.0.1:13000')
    fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out:
        out.write(''.join(f'{k}={v}\n' for k,v in values.items()))
else:
    values=dict(line.split('=',1) for line in env.read_text().splitlines() if line and not line.startswith('#'))
env.chmod(0o600)
garage = runtime/'garage.toml'
if not garage.exists():
    garage.write_text(f'''metadata_dir = "/var/lib/garage/meta"
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
garage.chmod(0o600)
credentials=runtime/'credentials.json'
if not credentials.exists():
    credentials.write_text(json.dumps({'environment':'isolated mock development only','adminer':{'server':'postgres','database':'botai','username':'botai_operator','password':values['OPS_DB_PASSWORD']},'accounts':{name:{'email':f'{name}@integration.botai.example','password':secrets.token_urlsafe(24)} for name in ['student','second','pro','admin']}},ensure_ascii=False,indent=2)+'\n')
credentials.chmod(0o600)
print(f'Credentials preserved in {credentials}; private service env in {env}')
