#!/usr/bin/env python3
"""Idempotent isolated stack startup; existing volumes and credentials survive."""
import argparse,json,socket,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--with-frontend',action='store_true')
parser.add_argument('--ops',action='store_true')
parser.add_argument('--skip-build',action='store_true')
args=parser.parse_args()
subprocess.run(['python3',str(root/'scripts/integration/init-secrets.py')],check=True)
values=dict(line.split('=',1) for line in (root/'runtime/.env.integration').read_text().splitlines() if line and not line.startswith('#'))
project=values.get('COMPOSE_PROJECT_NAME','botai-integration-local')
ids=subprocess.check_output(['docker','ps','-q','--filter',f'label=com.docker.compose.project={project}'],text=True).split()
owned=set()
if ids:
    for info in json.loads(subprocess.check_output(['docker','inspect',*ids])):
        for bindings in info['NetworkSettings']['Ports'].values():
            for bind in bindings or []:owned.add(int(bind['HostPort']))
ports=[18082,18025]+([13000] if args.with_frontend else [])+([18090] if args.ops else [])
for port in ports:
    with socket.socket() as s:
        if s.connect_ex(('127.0.0.1',port))==0 and port not in owned:raise SystemExit(f'Port {port} is occupied by a different process; preserve it and choose another port')
ai=Path(values['AI_CONTEXT'])
if not (ai/'manifest.json').exists():
    subprocess.run(['python3',str(root.parent/'botai-ai/deploy/build_runtime.py'),str(ai)],check=True)
command=[str(root/'scripts/integration/compose.sh')]
if args.with_frontend:command+=['--profile','web']
if args.ops:command+=['--profile','ops']
if not args.skip_build:
    for service in ['ai','backend']+(['frontend'] if args.with_frontend else []):
        subprocess.run(command+['build',service],check=True)
subprocess.run(command+['up','-d','--wait','--wait-timeout','180'],check=True)
subprocess.run(command+['exec','-T','garage','/garage','bucket','set-quotas','botai','--max-size','4GiB','--max-objects','10000'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
with (root/'scripts/integration/operator-views.sql').open('rb') as sql:
    subprocess.run(command+['exec','-T','postgres','psql','-v','ON_ERROR_STOP=1','-U','botai_migrator','-d','botai'],stdin=sql,stdout=subprocess.DEVNULL,check=True)
subprocess.run(command+['exec','-T','garage','/garage','bucket','deny','botai','--owner','--key',values['S3_ACCESS_KEY']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
print('Stack ready. Front13000, backend18082, mailpit18025, optional Adminer18090: loopback only.')
