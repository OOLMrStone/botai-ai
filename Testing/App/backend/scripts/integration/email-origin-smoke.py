#!/usr/bin/env python3
"""Private isolated registration/mail-origin/verification check; no token output."""
import argparse,http.cookiejar,json,re,secrets,time,urllib.request,urllib.parse,uuid
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--base-url',default='http://127.0.0.1:18082')
p.add_argument('--mailpit-url',default='http://127.0.0.1:18025')
p.add_argument('--expected-origin',default='http://127.0.0.1:13000')
a=p.parse_args()
for value in [a.base_url,a.mailpit_url,a.expected_origin]:
    u=urllib.parse.urlsplit(value)
    if u.scheme!='http' or u.hostname not in ['localhost','127.0.0.1'] or u.path or u.username or u.password:
        raise SystemExit('Only isolated loopback HTTP origins allowed')
jar=http.cookiejar.CookieJar();o=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def api(method,path,body=None):
    headers={'Content-Type':'application/json'}
    if method!='GET':headers['X-XSRF-TOKEN']=next(c.value for c in jar if c.name=='XSRF-TOKEN')
    req=urllib.request.Request(a.base_url+path,None if body is None else json.dumps(body).encode(),headers,method=method)
    with o.open(req,timeout=15) as r:
        raw=r.read();return json.loads(raw) if raw else None
email='mail-origin-'+uuid.uuid4().hex+'@integration.botai.example';password='B!'+secrets.token_urlsafe(24)
api('GET','/api/auth/csrf');api('POST','/api/auth/register',{'email':email,'password':password,'displayName':'Mail origin fixture'})
message=None
for _ in range(15):
    with urllib.request.urlopen(a.mailpit_url+'/api/v1/search?query='+urllib.parse.quote('to:'+email),timeout=10) as r:messages=json.load(r).get('messages',[])
    if messages:
        with urllib.request.urlopen(a.mailpit_url+'/api/v1/message/'+messages[0]['ID'],timeout=10) as r:message=json.load(r)
        break
    time.sleep(1)
assert message,'verification mail did not reach isolated sink'
text=message.get('Text','')+' '+message.get('HTML','')
match=re.search(r'http://[^\s<>"\']+/verify-email\?token=[A-Za-z0-9_%+.-]+',text)
assert match,'verification URL absent'
url=urllib.parse.urlsplit(match.group());assert f'{url.scheme}://{url.netloc}'==a.expected_origin,'verification URL uses wrong stack origin'
token=urllib.parse.parse_qs(url.query)['token'][0]
api('POST','/api/auth/email/verify',{'token':token});api('POST','/api/auth/login',{'email':email,'password':password});me=api('GET','/api/auth/me');assert me['emailVerified'] is True
print('EMAIL ORIGIN PASS: registration → isolated Mailpit → configured verify-email origin → consumed token → verified login; no secrets printed')
