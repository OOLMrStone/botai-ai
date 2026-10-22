#!/usr/bin/env python3
"""Bounded, resumable public BankZadach acquisition. Never publishes content.

Raw JSON/media remain private/inert. No cookies, auth, proxies, redirects or JS
execution. Exact fixed source hosts and observed GET routes only. Latest user
scope authorizes this provider, superseding the earlier Shkolkovo-only scope.
"""
from __future__ import annotations
import argparse, hashlib, html, http.client, json, os, queue, re, socket, ssl
import tempfile, threading, time, zlib, signal
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qs, unquote

UUID=r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
SITE='bank-zadach.ru'; API='prod.bank-zadach.ru'; MEDIA='s3.twcstorage.ru'
BUCKET='a2018d32-da73c04f-9bf7-477c-ae8e-f12f3b30af82'
SEED='32d51648-03f7-4244-99ac-6b2b254ffc4d'
MAX_BODY=32*1024*1024
class Stop(Exception): pass

def now(): return datetime.now(timezone.utc).isoformat()
def digest(b): return hashlib.sha256(b).hexdigest()
def write(path,b):
    path.parent.mkdir(parents=True,exist_ok=True);os.chmod(path.parent,0o700)
    if path.is_symlink(): raise Stop('symlink_output')
    fd,name=tempfile.mkstemp(prefix='.acquire-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(b)
        os.chmod(name,0o600);os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
def save(path,x):write(path,json.dumps(x,ensure_ascii=False,indent=2).encode())
def canonical(url):
    p=urlsplit(html.unescape(url));return urlunsplit((p.scheme,p.netloc,p.path,'',''))
def validate(url):
    if len(url)>8192 or any(ord(c)<33 for c in url) or '\\' in url:raise Stop('invalid_url')
    p=urlsplit(url)
    if p.scheme!='https' or p.hostname not in {SITE,API,MEDIA} or p.port not in {None,443} or p.username or p.password or p.fragment:raise Stop('unapproved_origin')
    path=unquote(p.path)
    if unquote(path)!=path or any(x in {'.','..'} for x in path.split('/')) or '//' in path:raise Stop('ambiguous_path')
    q=parse_qs(p.query,keep_blank_values=True)
    if p.hostname==SITE:
        ok=bool(re.fullmatch('/tasks(?:/'+UUID+')?',path)) and not q
    elif p.hostname==API:
        ok=(path=='/api/v1/tasks' and set(q)=={'subtopic','track','page','per_page'} and all(len(v)==1 for v in q.values()) and bool(re.fullmatch(UUID,q['subtopic'][0])) and q['track']==['ege_math'] and q['per_page']==['50'] and bool(re.fullmatch(r'[1-9][0-9]{0,2}',q['page'][0]))) or (bool(re.fullmatch('/api/v1/tasks/'+UUID,path)) and not q) or (bool(re.fullmatch('/api/v1/task-images/'+UUID+r'/(?:original\.(?:svg|png|webp|jpg|jpeg)|thumbnail.webp)',path)) and set(q)<={'v'} and all(len(v)==1 and re.fullmatch('[a-f0-9]{1,64}',v[0]) for v in q.values()))
    else:
        ok=bool(re.fullmatch('/'+BUCKET+r'/(?:(?:solutions_custom|tasks)/'+UUID+r'/[A-Za-z0-9_-]+\.(?:svg|png|jpg|jpeg|webp)|rendered-latex/solution-fragment-v1/[a-f0-9]{64}/fragment\.svg)',path)) and set(q)<={'X-Amz-Algorithm','X-Amz-Credential','X-Amz-Date','X-Amz-Expires','X-Amz-SignedHeaders','X-Amz-Signature'} and all(len(v)==1 and len(v[0])<512 for v in q.values())
    if not ok:raise Stop('unapproved_route')
    return p

class Transport:
    def __init__(self,pause=1.0,max_requests=12000,max_bytes=2*1024**3,max_seconds=14400):
        self.pause=max(0.8,pause);self.last={};self.addresses={};self.n=0;self.bytes=0
        self.max_requests=max_requests;self.max_bytes=max_bytes;self.end=time.monotonic()+max_seconds
    def get(self,url):
        p=validate(url);host=p.hostname
        if self.n>=self.max_requests or self.bytes>=self.max_bytes or time.monotonic()>self.end:raise Stop('run_budget')
        time.sleep(max(0,self.last.get(host,0)+self.pause-time.monotonic()));self.last[host]=time.monotonic();self.n+=1
        if host not in self.addresses:
            q=queue.Queue()
            def resolve():
                try:q.put(socket.getaddrinfo(host,443,type=socket.SOCK_STREAM))
                except Exception:q.put(None)
            threading.Thread(target=resolve,daemon=True).start()
            try:addresses=q.get(timeout=5)
            except queue.Empty:raise Stop('dns_timeout')
            if not addresses or len(addresses)>32:raise Stop('dns_failure')
            self.addresses[host]=(addresses[0][0],addresses[0][4])
        family,address=self.addresses[host];ctx=ssl.create_default_context();conn=http.client.HTTPSConnection(host,443,timeout=30,context=ctx)
        live=[None];cancelled=threading.Event();deadline=min(self.end,time.monotonic()+30)
        def cancel():
            cancelled.set()
            if live[0]:
                try:live[0].shutdown(socket.SHUT_RDWR)
                except OSError:pass
        def connect():
            raw=socket.socket(family,socket.SOCK_STREAM);live[0]=raw;raw.settimeout(max(.01,deadline-time.monotonic()));raw.connect(address)
            wrapped=ctx.wrap_socket(raw,server_hostname=host,do_handshake_on_connect=False);live[0]=conn.sock=wrapped;wrapped.settimeout(max(.01,deadline-time.monotonic()));wrapped.do_handshake()
        conn.connect=connect;timer=threading.Timer(max(.01,deadline-time.monotonic()),cancel);timer.daemon=True;timer.start();r=None
        try:
            conn.request('GET',p.path+('?' + p.query if p.query else ''),headers={'Host':host,'Accept-Encoding':'identity','User-Agent':'BotAIContentImport/1.0'})
            r=conn.getresponse();body=bytearray();limit=min(MAX_BODY,self.max_bytes-self.bytes)
            while True:
                if cancelled.is_set() or time.monotonic()>deadline:raise Stop('request_deadline')
                live[0].settimeout(max(.01,deadline-time.monotonic()));chunk=r.read1(min(65536,limit+1-len(body)))
                if not chunk:break
                body.extend(chunk);self.bytes+=len(chunk)
                if len(body)>limit:raise Stop('body_budget')
            if r.status in {401,403,429}:raise Stop('access_stop_'+str(r.status))
            if r.status!=200:raise Stop('http_'+str(r.status))
            ct=r.getheader('Content-Type','').split(';')[0]
            encoding=r.getheader('Content-Encoding','identity').lower()
            # TWC objects currently retain upload metadata Content-Encoding: aws-chunked,
            # but their observed GET body is an ordinary SVG, not an AWS chunk stream.
            raw_bytes=bytes(body)
            media_magic=(ct=='image/svg+xml' and raw_bytes.lstrip().startswith((b'<svg',b'<?xml'))) or (ct=='image/webp' and raw_bytes[:4]==b'RIFF' and raw_bytes[8:12]==b'WEBP') or (ct=='image/png' and raw_bytes.startswith(b'\x89PNG\r\n\x1a\n')) or (ct=='image/jpeg' and raw_bytes.startswith(b'\xff\xd8\xff'))
            if encoding=='aws-chunked' and host==MEDIA and media_magic:
                encoding='identity'
            if encoding not in {'','identity','gzip','deflate'}:raise Stop('unsupported_encoding')
            size=r.getheader('Content-Length')
            if size is not None and (not size.isdigit() or int(size)!=len(body)):raise Stop('incomplete_body')
            if encoding in {'gzip','deflate'}:
                dec=zlib.decompressobj(31 if encoding=='gzip' else 15)
                body=bytearray(dec.decompress(bytes(body),MAX_BODY+1))
                if len(body)>MAX_BODY or dec.unconsumed_tail or not dec.eof:raise Stop('decoded_body_budget')
            if r.getheader('cf-mitigated','')=='challenge' or ('html' in ct and any(x in body[:65536].lower() for x in [b'cf-chl-',b'challenge-platform',b'<title>just a moment',b'<title>attention required'])):raise Stop('access_challenge')
            return bytes(body),ct
        except (OSError,http.client.HTTPException,zlib.error) as e:raise Stop(type(e).__name__) from None
        finally:
            timer.cancel()
            if r:r.close()
            conn.close()
            if live[0]:live[0].close()

class Scripts(HTMLParser):
    def __init__(self):super().__init__();self.on=False;self.parts=[];self.current=[]
    def handle_starttag(self,t,a):
        if t=='script':self.on=True;self.current=[]
    def handle_data(self,d):
        if self.on:self.current.append(d)
    def handle_endtag(self,t):
        if t=='script' and self.on:self.parts.append(''.join(self.current));self.on=False

def payload(raw):
    p=Scripts();p.feed(raw.decode('utf8'));chunks=[]
    for s in p.parts:
        if s.startswith('self.__next_f.push('):
            try:a=json.loads(s[len('self.__next_f.push('):].rstrip(';')[:-1])
            except ValueError:continue
            if len(a)>1 and isinstance(a[1],str):chunks.append(a[1])
    records={}
    stream=''.join(chunks).encode('utf8');offset=0
    while offset<len(stream):
        while offset<len(stream) and stream[offset:offset+1]==b'\n':offset+=1
        text_match=re.match(rb'([0-9a-f]+):T([0-9a-f]+),',stream[offset:])
        if text_match:
            start=offset+text_match.end();end=start+int(text_match[2],16)
            records[text_match[1].decode()]=stream[start:end].decode('utf8');offset=end;continue
        end=stream.find(b'\n',offset)
        if end<0:end=len(stream)
        line=stream[offset:end].decode('utf8');offset=end+1
        if ':' not in line:continue
        k,v=line.split(':',1)
        try:records[k]=json.loads(v)
        except ValueError:pass
    def resolve(v,depth=0):
        if depth>70:raise Stop('hydration_depth')
        if isinstance(v,str) and re.fullmatch(r'\$[0-9a-f]+(?::[^:]+)*',v):
            bits=v[1:].split(':');out=records.get(bits[0],v)
            for bit in bits[1:]:out=out.get(bit,v) if isinstance(out,dict) else out[int(bit)] if isinstance(out,list) and bit.isdigit() else out[3] if isinstance(out,list) and len(out)>3 and bit=='props' else v
            return resolve(out,depth+1) if out!=v else out
        if isinstance(v,list):return [resolve(x,depth+1) for x in v]
        if isinstance(v,dict):return {k:resolve(x,depth+1) for k,x in v.items()}
        return v
    def find(v):
        if isinstance(v,dict):
            if 'catalogParts' in v and 'tasks' in v:return resolve(v)
            for x in v.values():
                out=find(x)
                if out:return out
        if isinstance(v,list):
            for x in v:
                out=find(x)
                if out:return out
    for v in records.values():
        out=find(v)
        if out:return out
    raise Stop('missing_hydration')

class Images(HTMLParser):
    def __init__(self):super().__init__();self.urls=[]
    def handle_starttag(self,t,attrs):
        if t=='img':
            for k,v in attrs:
                if k=='src' and v:self.urls.append(v)

def image_urls(task):
    found=set()
    def walk(v,key=''):
        if isinstance(v,dict):
            for k,x in v.items():
                if k in {'seo','tags','source_references','attachments','solution_attachments','video_url','videos'}:continue
                walk(x,k)
        elif isinstance(v,list):
            for x in v:walk(x,key)
        elif isinstance(v,str):
            if '<img' in v:
                p=Images();p.feed(v);found.update(p.urls)
            if key in {'image_url','src'} or (key=='url' and (v.startswith('/api/v1/task-images/') or v.startswith('https://'+MEDIA+'/'))):found.add(v)
    walk(task)
    return sorted(found)

class Acquisition:
    def __init__(self,root,transport):
        self.root=root;self.net=transport;root.mkdir(parents=True,exist_ok=True);os.chmod(root,0o700)
        self.manifest=json.loads((root/'media-manifest.json').read_text()) if (root/'media-manifest.json').exists() else {'schemaVersion':'bankzadach-raw.v1','assets':[],'tasks':{}}
        self.assets={a['identity']:a for a in self.manifest['assets']}
    def cached_get(self,url,path):
        if path.exists():
            if path.is_symlink() or path.stat().st_size>MAX_BODY:raise Stop('bad_cache')
            return path.read_bytes()
        raw,ct=self.net.get(url);write(path,raw);self.log({'kind':'raw','identity':canonical(url),'path':str(path.relative_to(self.root)),'sha256':digest(raw),'bytes':len(raw),'contentType':ct});return raw
    def log(self,row):
        row['retrievedAt']=now()
        with open(self.root/'ledger.jsonl','a',encoding='utf8') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
        os.chmod(self.root/'ledger.jsonl',0o600)
    def checkpoint(self):
        self.manifest['assets']=list(self.assets.values());save(self.root/'media-manifest.json',self.manifest)
    def census(self):
        seed=payload(self.cached_get('https://'+SITE+'/tasks/'+SEED,self.root/'catalog/topics'/f'{SEED}.html'))
        topics=[t for part in seed['catalogParts'] for t in part['topics']]
        if len(topics)>30 or sum(len(t['subtopics']) for t in topics)>500:raise Stop('catalog_bound')
        tasks={};subtopics=[]
        for t in topics:
            for sub in t['subtopics']:
                sid=sub['id'];d=payload(self.cached_get('https://'+SITE+'/tasks/'+sid,self.root/'catalog/topics'/f'{sid}.html'))
                if d['totalTasks']>5000:raise Stop('topic_size_bound')
                page=2
                while len(d['tasks'])<d['totalTasks']:
                    url='https://'+API+'/api/v1/tasks?subtopic='+sid+'&track=ege_math&page='+str(page)+'&per_page=50'
                    more=json.loads(self.cached_get(url,self.root/'catalog/pages'/f'{sid}-{page}.json'))
                    if not more.get('tasks'):raise Stop('empty_pagination_'+sid)
                    seen={x['id'] for x in d['tasks']};fresh=[x for x in more['tasks'] if x['id'] not in seen]
                    if not fresh:raise Stop('stalled_pagination_'+sid)
                    d['tasks'].extend(fresh);page+=1
                if len(d['tasks'])!=d['totalTasks']:raise Stop('incomplete_topic_'+sid)
                member={'topicId':t['id'],'topicNumber':t['number'],'topicName':t['name'],'subtopicId':sid,'subtopicName':sub['name']}
                subtopics.append({**member,'declaredCount':sub['tasks_count'],'retrievedCount':len(d['tasks'])})
                for task in d['tasks']:
                    tid=task['id']
                    if not re.fullmatch(UUID,tid):raise Stop('invalid_task_id')
                    tasks.setdefault(tid,{'id':tid,'memberships':[]})['memberships'].append(member)
                save(self.root/'census.partial.json',{'topics':topics,'subtopics':subtopics,'tasks':list(tasks.values())})
        out={'schemaVersion':'bankzadach-census.v1','retrievedAt':now(),'catalogDeclaredCount':sum(p['tasks_count'] for p in seed['catalogParts']),'topics':topics,'subtopics':subtopics,'tasks':list(tasks.values())}
        save(self.root/'census.json',out);return out
    def task(self,item):
        tid=item['id'];old=self.manifest['tasks'].get(tid,{})
        if old.get('complete'):
            for identity in old.get('urls',{}).values():
                asset=self.assets.get(identity)
                if not asset:raise Stop('missing_cached_asset_record')
                cached=self.root/asset['path']
                if cached.is_symlink() or not cached.resolve().is_relative_to(self.root.resolve()) or not cached.is_file() or cached.stat().st_size>MAX_BODY or digest(cached.read_bytes())!=asset['sha256']:
                    raise Stop('invalid_cached_asset')
            return
        path=self.root/'details'/f'{tid}.json'
        # Refresh unfinished details after 30 minutes so signed assets remain live.
        if path.exists() and time.time()-path.stat().st_mtime>1800:path.unlink()
        d=json.loads(self.cached_get('https://'+API+'/api/v1/tasks/'+tid,path))
        row={'urls':{},'complete':False,'retrievedAt':now()};self.manifest['tasks'][tid]=row
        for original in image_urls(d):
            url=html.unescape(original)
            if url.startswith('/'):url='https://'+API+url
            identity=canonical(url);row['urls'][original]=identity
            if identity in self.assets:continue
            try:validate(url)
            except Stop:
                row.setdefault('unsupportedMedia',[]).append(identity);continue
            raw,ct=self.net.get(url)
            ext={'image/svg+xml':'svg','image/png':'png','image/webp':'webp','image/jpeg':'jpg'}.get(ct)
            if not ext:
                if raw.lstrip().startswith((b'<svg',b'<?xml')):ext='svg'
                else:raise Stop('unsupported_media_type')
            sha=digest(raw);rel='media/'+sha+'.'+ext;write(self.root/rel,raw)
            asset={'identity':identity,'path':rel,'sha256':sha,'contentType':ct,'bytes':len(raw)};self.assets[identity]=asset;self.log({'kind':'media',**asset})
        row['complete']=not row.get('unsupportedMedia');self.checkpoint()
    def run(self,limit=0):
        census=json.loads((self.root/'census.json').read_text()) if (self.root/'census.json').exists() else self.census()
        for index,item in enumerate(census['tasks'][:limit or None]):
            self.task(item)
            if index%25==0:print(json.dumps({'processed':index+1,'total':len(census['tasks']),'complete':sum(t.get('complete',False) for t in self.manifest['tasks'].values()),'media':len(self.assets),'requests':self.net.n}),flush=True)
        summary={'finishedAt':now(),'uniqueTasks':len(census['tasks']),'detailCount':len(list((self.root/'details').glob('*.json'))),'complete':sum(t.get('complete',False) for t in self.manifest['tasks'].values()),'media':len(self.assets),'requestsThisRun':self.net.n,'bytesThisRun':self.net.bytes}
        save(self.root/'summary.json',summary);save(self.root/'status.json',{'state':'finished','at':now(),**summary});print(json.dumps(summary),flush=True)

def main():
    os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]/'runtime/content-import/bankzadach');p.add_argument('--limit',type=int,default=0);p.add_argument('--pause',type=float,default=1.0);p.add_argument('--max-requests',type=int,default=12000);p.add_argument('--max-seconds',type=int,default=14400);a=p.parse_args()
    if not 0<=a.limit<=10000 or not 0.8<=a.pause<=10 or not 1<=a.max_requests<=20000 or not 1<=a.max_seconds<=21600:p.error('invalid bounds')
    acq=Acquisition(a.root,Transport(a.pause,a.max_requests,max_seconds=a.max_seconds))
    if (a.root/'stop.json').exists():(a.root/'stop.json').unlink()
    save(a.root/'status.json',{'state':'running','at':now(),'pid':os.getpid()})
    def interrupt(signum,frame):raise Stop('operator_stop')
    signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
    try:acq.run(a.limit)
    except Stop as e:
        acq.checkpoint();save(a.root/'status.json',{'state':'stopped','at':now(),'reason':str(e)});save(a.root/'stop.json',{'at':now(),'reason':str(e),'requests':acq.net.n,'bytes':acq.net.bytes});print('STOP '+str(e),flush=True);return 2
    return 0
if __name__=='__main__':raise SystemExit(main())
