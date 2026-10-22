#!/usr/bin/env python3
"""Use one cookie jar to prove local/stage sessions are isolated by hostname."""
import argparse,http.cookiejar,http.cookies,json,subprocess,urllib.request,urllib.parse
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--local-url',default='http://127.0.0.1:13000')
p.add_argument('--stage-url',default='http://localhost:23000')
a=p.parse_args()
if urllib.parse.urlsplit(a.local_url).hostname!='127.0.0.1' or urllib.parse.urlsplit(a.stage_url).hostname!='localhost':raise SystemExit('Use distinct isolated loopback hostnames')
root=Path(__file__).resolve().parents[2]
local=json.loads((root/'runtime/credentials.json').read_text())['accounts']['student']
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=12','ege-server','cat /srv/botai-integration/runtime/credentials.json'],capture_output=True,check=True)
stage=json.loads(r.stdout)['accounts']['student']
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def api(origin,method,path,data=None):
    request=urllib.request.Request(origin+path,None if data is None else json.dumps(data).encode(),{'Content-Type':'application/json'},method=method)
    jar.add_cookie_header(request)
    if method!='GET':
        cookies=http.cookies.SimpleCookie();cookies.load(request.get_header('Cookie',''))
        request.add_header('X-XSRF-TOKEN',cookies['XSRF-TOKEN'].value)
    with opener.open(request,timeout=20) as response:
        body=response.read();return json.loads(body) if body else None
for origin,creds in [(a.local_url,local),(a.stage_url,stage)]:
    api(origin,'GET','/api/auth/csrf');api(origin,'POST','/api/auth/login',{'email':creds['email'],'password':creds['password']})
local_id=api(a.local_url,'GET','/api/auth/me')['id'];stage_id=api(a.stage_url,'GET','/api/auth/me')['id'];assert local_id!=stage_id
for _ in range(3):
    assert api(a.local_url,'GET','/api/auth/me')['id']==local_id
    assert api(a.stage_url,'GET','/api/auth/me')['id']==stage_id
assert len([c for c in jar if c.name=='SESSION'])==2
api(a.stage_url,'POST','/api/auth/logout');assert api(a.local_url,'GET','/api/auth/me')['id']==local_id
print('DUAL ORIGIN PASS: one cookie jar keeps distinct local/stage accounts; stage logout preserves local session')
