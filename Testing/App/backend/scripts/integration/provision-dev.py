#!/usr/bin/env python3
"""Explicit isolated-development account setup through normal auth + DB roles."""
import argparse, http.cookiejar, json, subprocess, urllib.request, urllib.error
from pathlib import Path
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--confirm-isolated-development',action='store_true',required=True)
parser.add_argument('--base-url',default='http://127.0.0.1:18082')
args=parser.parse_args()
if args.base_url not in ['http://127.0.0.1:18082','http://localhost:18082']:raise SystemExit('Only isolated loopback backend is allowed')
creds=json.loads((root/'runtime/credentials.json').read_text())
for name,account in creds['accounts'].items():
    jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    with opener.open(args.base_url+'/api/auth/csrf') as response:csrf=json.load(response)
    payload=json.dumps(dict(email=account['email'],password=account['password'],displayName='Integration '+name)).encode()
    request=urllib.request.Request(args.base_url+'/api/auth/register',payload,{'Content-Type':'application/json',csrf['headerName']:next(c.value for c in jar if c.name=='XSRF-TOKEN')})
    try:
        with opener.open(request) as response:assert response.status==201
    except urllib.error.HTTPError as error:
        if error.code!=409:raise SystemExit(f'Provision {name} failed HTTP {error.code}')
    # Only synthetic fixture domains are eligible; never provision a production account.
    if not account['email'].endswith('@integration.botai.example'):raise SystemExit('Unexpected fixture domain')
    sql="UPDATE users SET role=%s,plan_id=%s,email_verified=true WHERE email=%s;" % ("'ADMIN'" if name=='admin' else "'USER'","'pro'" if name in ['pro','admin'] else "'free'","'"+account['email'].replace("'","''")+"'")
    subprocess.run([str(root/'scripts/integration/compose.sh'),'exec','-T','postgres','psql','-v','ON_ERROR_STOP=1','-U','botai_migrator','-d','botai'],input=sql.encode(),stdout=subprocess.DEVNULL,check=True)
print('Four isolated development accounts provisioned; credentials.json preserved')
