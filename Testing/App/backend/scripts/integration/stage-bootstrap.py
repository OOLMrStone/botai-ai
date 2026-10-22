#!/usr/bin/env python3
"""Initialize only /srv/botai-integration after approved code-only stage transfer."""
import argparse,os,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--confirm-isolated-stage',action='store_true',required=True)
parser.add_argument('--start',action='store_true')
args=parser.parse_args()
base=Path('/srv/botai-integration')
back=Path(__file__).resolve().parents[2]
if os.geteuid()!=0 or back!=base/'back':raise SystemExit('Run as root only from isolated /srv/botai-integration/back')
base.chmod(0o700)
marker=base/'.botai-isolated-integration'
if marker.exists() and marker.read_text()!='botai-integration-stage\n':raise SystemExit('Unexpected stage identity')
if not marker.exists():
    for name in ['runtime','data','backups']:
        directory=base/name
        if directory.exists() and (directory.is_symlink() or any(directory.iterdir())):
            raise SystemExit('Preserve unidentified existing stage data before initializing')
# The extraction procedure must precheck any preexisting destination before copying.
for name in ['back','front','ai','runtime','data','backups']:
    directory=base/name;directory.mkdir(exist_ok=True)
    if directory.is_symlink():raise SystemExit('Unexpected stage symlink: '+name)
    directory.chmod(0o700 if name in ['runtime','data','backups'] else 0o755)
marker.write_text('botai-integration-stage\n');marker.chmod(0o600)
for link,target in [(back/'runtime',base/'runtime'),(base/'runtime/backups',base/'backups')]:
    if link.is_symlink():
        if link.resolve()!=target:raise SystemExit('Unexpected runtime symlink')
    elif link.exists():raise SystemExit('Preserve existing runtime; reconcile before initializing')
    else:link.symlink_to(target,target_is_directory=True)
subprocess.run(['python3',str(back/'scripts/integration/init-secrets.py')],check=True)
(base/'runtime/STAGE').write_text('botai-integration-stage\n')
(base/'runtime/STAGE').chmod(0o600)
env=base/'runtime/.env.integration'
values=dict(line.split('=',1) for line in env.read_text().splitlines() if line and not line.startswith('#'))
values.update(COMPOSE_PROJECT_NAME='botai-integration-stage',FRONT_CONTEXT='../front',AI_CONTEXT='../ai',FRONTEND_BASE_URL='http://localhost:23000')
env.write_text(''.join(f'{k}={v}\n' for k,v in values.items()));env.chmod(0o600)
print('Isolated stage paths/secrets prepared; no production configuration touched')
if args.start:
    subprocess.run(['python3',str(back/'scripts/integration/start.py'),'--with-frontend','--ops'],cwd=back,check=True)
    subprocess.run(['python3',str(back/'scripts/integration/provision-dev.py'),'--confirm-isolated-development'],cwd=back,check=True)
    subprocess.run(['python3',str(back/'scripts/integration/api-smoke.py'),'--base-url','http://127.0.0.1:13000'],cwd=back,check=True)
