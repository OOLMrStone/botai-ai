#!/usr/bin/env python3
"""Non-paid isolated HTTP gate. Uses only generated fixture accounts/images."""
import argparse,http.cookiejar,json,struct,subprocess,time,urllib.request,urllib.error,uuid,zlib
from pathlib import Path
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://127.0.0.1:18082');args=parser.parse_args()
creds=json.loads((root/'runtime/credentials.json').read_text())
class Client:
    def __init__(self,name):
        self.jar=http.cookiejar.CookieJar();self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar));self.name=name
        self.request('GET','/api/auth/csrf')
        self.request('POST','/api/auth/login',creds['accounts'][name])
        self.request('GET','/api/auth/csrf')
    def request(self,method,path,body=None,expected=200,extra=None,raw=False,csrf=True):
        headers=extra.copy() if extra else {}
        if body is not None and not isinstance(body,bytes):body=json.dumps(body).encode();headers['Content-Type']='application/json'
        if method not in ['GET','HEAD'] and csrf:headers['X-XSRF-TOKEN']=next(c.value for c in self.jar if c.name=='XSRF-TOKEN')
        request=urllib.request.Request(args.base_url+path,body,headers,method=method)
        try:
            with self.opener.open(request,timeout=20) as response:code=response.status;data=response.read();response_headers={k.lower():v for k,v in response.headers.items()}
        except urllib.error.HTTPError as e:code=e.code;data=e.read();response_headers={k.lower():v for k,v in e.headers.items()}
        assert code==expected,f'{self.name} {method} {path}: expected{expected} actual{code} {data[:350]!r}'
        if raw:return data,response_headers
        return json.loads(data) if data else None
    def create(self,numbers):return self.request('POST','/api/training-attempts',{'formatId':'ege-profile-20-v1','selections':[{'examNumber':n,'count':1} for n in numbers]},extra={'Idempotency-Key':str(uuid.uuid4())})
def image():
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\xff\xff'*16)*16))+chunk(b'IEND',b'')
def multipart(data):
    boundary='botai'+uuid.uuid4().hex
    body=f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+data+f'\r\n--{boundary}--\r\n'.encode()
    return body,{'Content-Type':'multipart/form-data; boundary='+boundary}
student=Client('student');pro=Client('pro');second=Client('second');admin=Client('admin')
catalog=pro.request('GET','/api/catalog');assert len(catalog['numbers'])==20 and catalog['format']['maxPoints']==33
assert [n['examNumber'] for n in catalog['numbers'] if n['gradingCapability']=='available' and n['responseType']=='photo']==[16]
a=pro.create([1,16]);b=pro.create([2]);template=pro.request('GET','/api/mock-exams')['items'][0]['id'];exam=pro.request('POST',f'/api/mock-exams/{template}/attempts',extra={'Idempotency-Key':str(uuid.uuid4())});assert len(exam['items'])==20
first=a['items'][0];a=pro.request('PATCH','/api/attempts/'+a['id'],{'revision':a['revision'],'currentIndex':1,'items':[{'id':first['id'],'answer':'0','drawing':[]}]})
second.request('GET','/api/attempts/'+a['id'],expected=404)
pro.request('PATCH','/api/attempts/'+a['id'],{'revision':a['revision'],'currentIndex':0},expected=403,csrf=False)
check_key=str(uuid.uuid4());checked=pro.request('POST',f'/api/attempts/{a["id"]}/checks',{'revision':a['revision'],'itemIds':[first['id']]},extra={'Idempotency-Key':check_key});again=pro.request('POST',f'/api/attempts/{a["id"]}/checks',{'revision':a['revision'],'itemIds':[first['id']]},extra={'Idempotency-Key':check_key});assert again['summary']==checked['summary']
item=checked['items'][1];s=pro.request('POST','/api/submissions',{'attemptId':a['id'],'attemptItemId':item['id'],'inputRevision':item['answerRevision']},extra={'Idempotency-Key':str(uuid.uuid4())})
body,headers=multipart(image());attachment=pro.request('POST',f'/api/submissions/{s["id"]}/images',body,extra=headers)
media,media_headers=pro.request('GET',attachment['previewUrl'],raw=True);assert media and 'no-store' in media_headers.get('cache-control','')
second.request('GET',attachment['previewUrl'],expected=404)
s=pro.request('GET','/api/submissions/'+s['id']);s=pro.request('POST',f'/api/submissions/{s["id"]}/finalize',{'expectedRevision':s['revision']})
for _ in range(25):
    s=pro.request('GET','/api/submissions/'+s['id'])
    if s['status'] not in ['queued','running']:break
    time.sleep(1)
assert s['status']=='graded' and s['isDemo'] and s['result']['isDemo'],s
assert 'reference_answer' not in json.dumps(s) and 'exactResponse' not in s
student.request('GET','/api/admin/submissions',expected=403)
admin.request('GET','/api/admin/submissions/'+s['id'])
avatar=pro.request('POST','/api/profile/avatar',body,extra=headers);pro.request('GET',avatar['avatarUrl'],raw=True)
unsupported=pro.create([14]);item=unsupported['items'][0];u=pro.request('POST','/api/submissions',{'attemptId':unsupported['id'],'attemptItemId':item['id'],'inputRevision':item['answerRevision']},extra={'Idempotency-Key':str(uuid.uuid4())});pro.request('POST',f'/api/submissions/{u["id"]}/images',body,extra=headers);u=pro.request('GET','/api/submissions/'+u['id']);u=pro.request('POST',f'/api/submissions/{u["id"]}/finalize',{'expectedRevision':u['revision']});assert u['status']=='unsupported' and (u.get('result') or {}).get('score') is None
pro.request('POST','/api/auth/logout');pro=Client('pro');resumed=pro.request('GET','/api/attempts/'+a['id']);assert resumed['id']==a['id'] and resumed['currentIndex']==1 and resumed['items'][0]['answer']=='0'
unfinished=pro.request('GET','/api/attempts?status=unfinished')['items'];assert {b['id'],exam['id'],unsupported['id']}<={v['id'] for v in unfinished}
stats=pro.request('GET','/api/stats');assert stats['xp']==0 and stats['streakDays']==0
print('HTTP PASS: auth/CSRF;20 taxonomy;collections+exam;draft/relogin;short idempotency;real photo bytes/private media→mock16;unsupported14;avatar;ownership/admin;demo no progress')
