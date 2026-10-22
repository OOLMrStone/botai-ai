#!/usr/bin/env python3
"""Offline SigV4 compatibility checks on the private development bucket."""
import argparse, datetime, hashlib, hmac, json, os, urllib.request, urllib.error, uuid
from pathlib import Path
values=dict(line.split('=',1) for line in Path(os.environ.get('INTEGRATION_ENV','/run/integration.env')).read_text().splitlines() if line and not line.startswith('#'))
endpoint=os.environ.get('S3_TEST_ENDPOINT','http://garage:3900')
key='runtime-smoke/'+str(uuid.uuid4())
payload=b'BotAI isolated storage restore witness v1\n'
def call(method, path, body=b'', signed=True):
    now=datetime.datetime.now(datetime.timezone.utc);date=now.strftime('%Y%m%d');stamp=now.strftime('%Y%m%dT%H%M%SZ')
    hashed=hashlib.sha256(body).hexdigest();host=urllib.parse.urlsplit(endpoint).netloc
    headers={'x-amz-date':stamp,'x-amz-content-sha256':hashed,'host':host}
    if signed:
        signed_headers='host;x-amz-content-sha256;x-amz-date'
        canonical=f'{method}\n{path}\n\n'+''.join(f'{k}:{headers[k]}\n' for k in ['host','x-amz-content-sha256','x-amz-date'])+'\n'+signed_headers+'\n'+hashed
        scope=f'{date}/garage/s3/aws4_request';string=f'AWS4-HMAC-SHA256\n{stamp}\n{scope}\n'+hashlib.sha256(canonical.encode()).hexdigest()
        derived=('AWS4'+values['S3_SECRET_KEY']).encode()
        for value in [date,'garage','s3','aws4_request']:derived=hmac.new(derived,value.encode(),hashlib.sha256).digest()
        sig=hmac.new(derived,string.encode(),hashlib.sha256).hexdigest()
        headers['Authorization']=f'AWS4-HMAC-SHA256 Credential={values["S3_ACCESS_KEY"]}/{scope}, SignedHeaders={signed_headers}, Signature={sig}'
    request=urllib.request.Request(endpoint+path,data=body if method=='PUT' else None,method=method,headers=headers)
    try:
        with urllib.request.urlopen(request,timeout=10) as response:return response.status,response.read(),{k.lower():v for k,v in response.headers.items()}
    except urllib.error.HTTPError as e:return e.code,e.read(),{k.lower():v for k,v in e.headers.items()}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--witness',choices=['put','verify','delete']);args=parser.parse_args()
    path='/botai/runtime-smoke/restore-witness' if args.witness else '/botai/'+key
    if args.witness:
        if args.witness=='put':assert call('PUT',path,payload)[0]==200
        elif args.witness=='verify':assert call('GET',path)[:2]==(200,payload)
        else:assert call('DELETE',path)[0]==204
        print('S3 restore witness '+args.witness+' PASS')
        raise SystemExit(0)
    assert call('PUT',path,payload)[0]==200
    assert call('GET',path)[:2]==(200,payload)
    code,_,headers=call('HEAD',path);assert code==200 and int(headers['content-length'])==len(payload)
    for method in ['GET','HEAD','PUT','DELETE']:assert call(method,path,payload if method=='PUT' else b'',False)[0] in [400,403]
    assert call('DELETE',path)[0]==204
    assert call('GET',path)[0]==404
    print('S3 PASS: authenticated PUT/GET/HEAD/DELETE, anonymous denial, deletion confirmed')
