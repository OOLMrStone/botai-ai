#!/usr/bin/env python3
"""Quiesce isolated mock stack, snapshot PG+Garage and verify detached restores."""
import datetime,json,os,shutil,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
compose=str(root/'scripts/integration/compose.sh')
values=dict(line.split('=',1) for line in (root/'runtime/.env.integration').read_text().splitlines() if line and not line.startswith('#'))
project=values['COMPOSE_PROJECT_NAME']
if project not in ['botai-integration-local','botai-integration-stage']:raise SystemExit('Only named isolated mock projects allowed')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=root/'runtime/backups'/stamp;backup.mkdir(parents=True,mode=0o700)
for p in [backup.parent,backup]:p.chmod(0o700)
def run(command,**kwargs):return subprocess.run(command,check=True,**kwargs)
def out(command):return subprocess.check_output(command,text=True).strip()
def dc(*args,**kwargs):return run([compose,*args],**kwargs)
def volume(service,target):
    cid=out([compose,'ps','-q',service]);info=json.loads(out(['docker','inspect',cid]))[0]
    return next(v['Name'] for v in info['Mounts'] if v['Destination']==target)
def storage(net,endpoint,action):
    run(['docker','run','--rm','--network',net,'-e','S3_TEST_ENDPOINT='+endpoint,'-v',str(root/'runtime/.env.integration')+':/run/integration.env:ro','-v',str(root/'scripts/integration/storage-smoke.py')+':/smoke.py:ro','python:3.14-slim','python','/smoke.py','--witness',action])
data=volume('garage','/var/lib/garage/data');meta=volume('garage','/var/lib/garage/meta')
storage(project+'_data','http://garage:3900','put')
query="SELECT jsonb_object_agg(tab,cnt) FROM ("+' UNION ALL '.join(f"SELECT '{t}' AS tab,count(*) AS cnt FROM {t}" for t in ['users','spring_session','exam_positions','topics','tasks','task_versions','attempts','attempt_items','grading_submissions','stored_objects','flyway_schema_history'])+") x;"
def fingerprint(service):return out([compose,'exec','-T',service,'psql','-U','botai_migrator','-d','botai','-Atc',query])
expected=fingerprint('postgres')
dc('stop','backend','garage',stdout=subprocess.DEVNULL)
try:
    with (backup/'postgres.dump').open('wb') as dest:dc('exec','-T','postgres','pg_dump','-U','botai_migrator','-d','botai','-Fc',stdout=dest)
    for name,vol in [('garage-data',data),('garage-meta',meta)]:
        run(['docker','run','--rm','--network','none','-v',vol+':/source:ro','-v',str(backup)+':/backup','postgres:17.11-bookworm','tar','-czf','/backup/'+name+'.tgz','-C','/source','.'])
    shutil.copyfile(root/'runtime/garage.toml',backup/'garage.toml')
finally:dc('up','-d','--wait','--wait-timeout','120','backend',stdout=subprocess.DEVNULL)
for path in backup.iterdir():path.chmod(0o600)
restore='botai-restore-'+stamp.lower()
net=restore+'-network';pg=restore+'-pg';garage=restore+'-garage'
volumes=[restore+'-pgdata',restore+'-s3data',restore+'-s3meta']
run(['docker','network','create','--internal',net],stdout=subprocess.DEVNULL)
for name in volumes:run(['docker','volume','create',name],stdout=subprocess.DEVNULL)
try:
    run(['docker','run','-d','--name',pg,'--network','none','--env-file',str(root/'runtime/.env.integration'),'-e','POSTGRES_DB=botai','-e','POSTGRES_USER=botai_migrator','-v',volumes[0]+':/var/lib/postgresql/data','-v',str(root/'scripts/integration/init-db.sh')+':/docker-entrypoint-initdb.d/10-roles.sh:ro','postgres:17.11-bookworm'],stdout=subprocess.DEVNULL)
    for _ in range(45):
        ready=subprocess.run(['docker','exec',pg,'pg_isready','-U','botai_migrator','-d','botai'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if ready.returncode==0:break
        time.sleep(1)
    with (backup/'postgres.dump').open('rb') as src:run(['docker','exec','-i',pg,'pg_restore','-U','botai_migrator','-d','botai','--no-owner','--exit-on-error'],stdin=src)
    actual=out(['docker','exec',pg,'psql','-U','botai_migrator','-d','botai','-Atc',query]);assert json.loads(actual)==json.loads(expected)
    for name,vol in [('garage-data',volumes[1]),('garage-meta',volumes[2])]:
        run(['docker','run','--rm','--network','none','-v',vol+':/target','-v',str(backup)+':/backup:ro','postgres:17.11-bookworm','tar','-xzf','/backup/'+name+'.tgz','-C','/target'])
    run(['docker','run','-d','--name',garage,'--network',net,'--network-alias','garage-restore','--env-file',str(root/'runtime/.env.integration'),'-v',str(backup/'garage.toml')+':/etc/garage.toml:ro','-v',volumes[1]+':/var/lib/garage/data','-v',volumes[2]+':/var/lib/garage/meta','dxflrs/garage:v2.3.0','/garage','server','--single-node'],stdout=subprocess.DEVNULL)
    for _ in range(30):
        ready=subprocess.run(['docker','exec',garage,'/garage','status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if ready.returncode==0:break
        time.sleep(1)
    storage(net,'http://garage-restore:3900','verify')
    manifest={'createdAt':stamp,'pgRestore':'PASS','garageWitnessRestore':'PASS','tableCounts':json.loads(actual),'restoreNetwork':'internal/no-published-ports','production':'untouched'}
    (backup/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(backup/'manifest.json').chmod(0o600)
    print('BACKUP/RESTORE PASS: isolated PG row counts + persistent S3 witness; original stack restored; snapshot '+str(backup))
finally:
    for container in [pg,garage]:subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['docker','network','rm',net],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    # Only rehearsal volumes with this unique generated name are removed.
    for vol in volumes:subprocess.run(['docker','volume','rm',vol],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    storage(project+'_data','http://garage:3900','delete')
# Keep the newest three snapshots; never touch active volumes.
old=sorted(p for p in backup.parent.iterdir() if p.is_dir() and len(p.name)==16 and p.name.endswith('Z'))
for p in old[:-3]:shutil.rmtree(p)
