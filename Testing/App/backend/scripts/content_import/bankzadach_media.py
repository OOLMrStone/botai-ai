#!/usr/bin/env python3
"""Normalize acquired BankZadach media in an isolated pinned Sharp container."""
import argparse,base64,hashlib,json,os,re,stat,struct,subprocess,tempfile,uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from acquire import private_directory,private_write
from svg import validate_svg
from render_svg import read_owned_file
from bankzadach_fonts import FONTS,TIMES_FONT


def safe_file(root,relative,limit):
    if not isinstance(relative,str) or '\\' in relative:
        raise ValueError('invalid_relative_path')
    rel=Path(relative)
    if rel.is_absolute() or '..' in rel.parts:raise ValueError('path_escape')
    p=root/rel
    if not p.resolve().is_relative_to(root.resolve()):raise ValueError('path_escape')
    if any((root/Path(*rel.parts[:i])).is_symlink() for i in range(1,len(rel.parts)+1)):
        raise ValueError('symlink')
    st=p.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_size>limit:raise ValueError('file_budget')
    return p.read_bytes()


def original_kind(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):return 'png'
    if raw.startswith(b'\xff\xd8\xff'):return 'jpeg'
    if raw[:4]==b'RIFF' and raw[8:12]==b'WEBP':return 'webp'
    if b'<svg' in raw[:1024] or raw.lstrip().startswith(b'<?xml'):return 'svg'
    raise ValueError('unsupported_media_format')


def unwrap_png(raw):
    # Lossless full-canvas PNG wrapper only; every other SVG stays in the vector validator.
    if len(raw)>2*1024*1024 or b'<!' in raw or b'<?' in raw:return None
    root=ET.fromstring(raw);svg='{http://www.w3.org/2000/svg}';href='{http://www.w3.org/1999/xlink}href'
    if root.tag!=svg+'svg' or set(root.attrib)!={'version','width','height','viewBox'} or root.get('version')!='1.1':return None
    if not re.fullmatch(r'[1-9][0-9]{0,3}',root.get('width','')) or not re.fullmatch(r'[1-9][0-9]{0,3}',root.get('height','')):return None
    w,h=int(root.get('width')),int(root.get('height'))
    if max(w,h)>8192 or w*h>20000000 or root.get('viewBox')!=f'0 0 {w} {h}':return None
    if len(root)!=1 or root[0].tag!=svg+'g' or root[0].attrib or len(root[0])!=1:return None
    node=root[0][0]
    if node.tag!=svg+'image' or len(node) or set(node.attrib)!={'id','width','height',href}:return None
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}',node.get('id','')) or node.get('width')!=str(w) or node.get('height')!=str(h):return None
    if any((n.text or '').strip() or (n.tail or '').strip() for n in root.iter()):return None
    encoded=node.get(href,'')
    if not encoded.startswith('data:image/png;base64,'):return None
    data=base64.b64decode(re.sub(r'\s','',encoded.split(',',1)[1]),validate=True)
    if len(data)<24 or data[:8]!=b'\x89PNG\r\n\x1a\n' or data[12:16]!=b'IHDR' or struct.unpack('>II',data[16:24])!=(w,h):raise ValueError('embedded_png_dimensions')
    return data


def prepare(raw):
    kind=original_kind(raw)
    if kind=='svg':
        embedded=unwrap_png(raw)
        if embedded is not None:raw,kind=embedded,'png'
        else:raw=validate_svg(raw,bankzadach=True).data
    return raw,kind,hashlib.sha256(raw).hexdigest()


def verify_output(out,entry):
    if set(entry)!={'key','status','width','height','bytes'} or entry['status']!='ok':raise ValueError('renderer_schema')
    if any(type(entry[k]) is not int or entry[k]<=0 for k in ('width','height','bytes')):raise ValueError('renderer_numbers')
    w,h=entry['width'],entry['height']
    if max(w,h)>8192 or w*h>20000000:raise ValueError('renderer_pixels')
    raw=read_owned_file(out,entry['key']+'.png',8*1024*1024)
    if len(raw)<24 or raw[:8]!=b'\x89PNG\r\n\x1a\n' or raw[12:16]!=b'IHDR' or struct.unpack('>II',raw[16:24])!=(w,h) or len(raw)!=entry['bytes']:raise ValueError('renderer_bytes')
    return raw


def render(root,items,image):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',image):raise ValueError('exact_image_required')
    scratch=root/'render-work';private_directory(scratch)
    with tempfile.TemporaryDirectory(dir=scratch) as tmp:
        task=Path(tmp);inp=task/'input';out=task/'output';private_directory(inp);private_directory(out)
        unique={it['key']:it for it in items}
        manifest=[]
        for key,it in unique.items():
            name=key+'.'+it['kind'];private_write(inp/name,it['data']);manifest.append({'file':name})
        private_write(inp/'manifest.json',json.dumps(manifest).encode())
        font_env=[]
        if any(it['kind']=='svg' and b'<text' in it['data'] for it in items):
            fonts=inp/'fonts';private_directory(fonts)
            required={}
            for it in items:
                if it['kind']!='svg' or b'<text' not in it['data']:continue
                if b'DejaVu Serif' in it['data']:required.update(FONTS)
                if b'Times New Roman' in it['data']:required[TIMES_FONT[0]]=TIMES_FONT[1]
            for filename,expected in required.items():
                font=safe_file(root,'renderer-fonts/'+filename,1024*1024)
                if hashlib.sha256(font).hexdigest()!=expected:raise ValueError('renderer_font_hash')
                private_write(fonts/filename,font)
            private_write(fonts/'fonts.conf',b'<fontconfig><dir>/input/fonts</dir><cachedir>/tmp/font-cache</cachedir></fontconfig>')
            font_env=['--env','FONTCONFIG_FILE=/input/fonts/fonts.conf']
        name='botai-bankzadach-media-'+uuid.uuid4().hex
        script=Path(__file__).with_name('bankzadach-render.cjs').resolve()
        cmd=['docker','run','--rm','--pull','never','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','384m','--cpus','1','--pids-limit','64','--user',f'{os.getuid()}:{os.getgid()}','--tmpfs','/tmp:rw,nosuid,noexec,size=16m','--mount',f'type=bind,src={inp.resolve()},dst=/input,readonly','--mount',f'type=bind,src={out.resolve()},dst=/output','--mount',f'type=bind,src={script},dst=/opt/render.cjs,readonly',*font_env,'--entrypoint','node',image,'/opt/render.cjs']
        try:subprocess.run(cmd,check=True,timeout=60,capture_output=True)
        finally:subprocess.run(['docker','rm','-f',name],timeout=10,capture_output=True)
        report=json.loads(read_owned_file(out,'render-report.json',1024*1024))
        if set(report)!={'results'} or not isinstance(report['results'],list) or len(report['results'])!=len(unique):raise ValueError('renderer_report')
        result={};pixels=0;total=0
        for entry in report['results']:
            key=entry.get('key')
            if key not in unique or key in result:raise ValueError('renderer_identity')
            if entry.get('status')=='rejected':
                if set(entry)!={'key','status','reason'} or entry['reason']!='raster_decode_or_budget':raise ValueError('renderer_reject')
                result[key]={'reason':entry['reason']};continue
            raw=verify_output(out,entry);pixels+=entry['width']*entry['height'];total+=len(raw)
            if pixels>64000000 or total>64*1024*1024:raise ValueError('renderer_aggregate')
            sha=hashlib.sha256(raw).hexdigest();relative='normalized-media/'+sha+'.png';dest=root/relative
            if dest.exists():
                if hashlib.sha256(safe_file(root,relative,8*1024*1024)).hexdigest()!=sha:raise ValueError('cache_hash')
            else:private_write(dest,raw)
            result[key]={'path':relative,'sha256':sha,'width':entry['width'],'height':entry['height']}
        return result


def quality_holds(root):
    path=root/'media-quality-issues.json'
    if not path.exists():return set()
    issues=json.loads(safe_file(root,path.name,1024*1024))
    if not isinstance(issues,dict):raise ValueError('media_quality_schema')
    holds=set()
    for sha,issue in issues.items():
        if not re.fullmatch(r'[a-f0-9]{64}',sha) or not isinstance(issue,dict) or issue.get('status') not in {'hold','resolved'}:
            raise ValueError('media_quality_schema')
        if issue['status']=='hold':holds.add(sha)
    return holds


def reviewed_rasters(root):
    path=root/'media-render-reviews.json'
    if not path.exists():return {}
    reviews=json.loads(safe_file(root,path.name,1024*1024))
    if not isinstance(reviews,dict):raise ValueError('media_render_review_schema')
    for source_sha,entry in reviews.items():
        if not re.fullmatch(r'[a-f0-9]{64}',source_sha) or not isinstance(entry,dict) or set(entry)!={'path','sha256','width','height','renderer','reviewed'}:
            raise ValueError('media_render_review_schema')
        if entry['reviewed'] is not True or entry['renderer']!='browser-reviewed-v1' or not re.fullmatch(r'[a-f0-9]{64}',entry['sha256']) or entry['path']!='normalized-media/'+entry['sha256']+'.png':
            raise ValueError('media_render_review_schema')
        w,h=entry['width'],entry['height']
        if type(w) is not int or type(h) is not int or min(w,h)<=0 or max(w,h)>8192 or w*h>20000000:
            raise ValueError('media_render_review_pixels')
        raw=safe_file(root,entry['path'],8*1024*1024)
        if hashlib.sha256(raw).hexdigest()!=entry['sha256'] or len(raw)<24 or raw[:8]!=b'\x89PNG\r\n\x1a\n' or raw[12:16]!=b'IHDR' or struct.unpack('>II',raw[16:24])!=(w,h):
            raise ValueError('media_render_review_bytes')
    return reviews


def main():
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--root',type=Path,required=True);cli.add_argument('--image-id',required=True);args=cli.parse_args()
    root=args.root.resolve();private_directory(root/'normalized-media')
    source=json.loads(safe_file(root,'media-manifest.json',64*1024*1024))['assets']
    old=json.loads(safe_file(root,'normalized-media.json',64*1024*1024)) if (root/'normalized-media.json').exists() else {'assets':[]}
    cache={a['identity']:a for a in old['assets']};ready=[];failed=[];pending=[];holds=quality_holds(root);reviews=reviewed_rasters(root)
    def save():private_write(root/'normalized-media.json',json.dumps({'assets':ready,'quarantine':failed},ensure_ascii=False,indent=2).encode())
    def flush():
        if not pending:return
        results=render(root,pending,args.image_id)
        for item in pending:
            result=results[item['key']]
            if 'reason' in result:failed.append({'identity':item['identity'],'reason':result['reason']})
            else:ready.append({'identity':item['identity'],'sourceSha256':item['originalSha'],'renderer':'bankzadach-v2-bounded-dpi','imageId':args.image_id,**result})
        pending.clear();save()
    for a in source:
        identity=a['identity']
        try:
            if a['sha256'] in holds:raise ValueError('media_quality_hold')
            if a['sha256'] in reviews:
                raw=safe_file(root,a['path'],8*1024*1024)
                if hashlib.sha256(raw).hexdigest()!=a['sha256']:raise ValueError('source_hash')
                entry={k:v for k,v in reviews[a['sha256']].items() if k!='reviewed'}
                ready.append({'identity':identity,'sourceSha256':a['sha256'],'imageId':args.image_id,**entry});continue
            previous=cache.get(identity)
            if previous and previous.get('renderer') in {'bankzadach-v1-288dpi','bankzadach-v2-bounded-dpi'} and previous.get('sourceSha256')==a['sha256'] and previous.get('imageId')==args.image_id:
                if hashlib.sha256(safe_file(root,previous['path'],8*1024*1024)).hexdigest()==previous['sha256']:
                    ready.append(previous);continue
            raw=safe_file(root,a['path'],8*1024*1024)
            if hashlib.sha256(raw).hexdigest()!=a['sha256']:raise ValueError('source_hash')
            data,kind,key=prepare(raw);pending.append({'identity':identity,'originalSha':a['sha256'],'key':key,'kind':kind,'data':data})
        except (ValueError,OSError) as e:
            # Messages are local validation codes, never upstream data/URLs.
            failed.append({'identity':identity,'reason':type(e).__name__+':'+str(e)[:160]})
        # Three images at the individual 20M-pixel ceiling fit the 64M batch budget.
        if len(pending)>=3:flush()
    flush();save();print(json.dumps({'sourceAssets':len(source),'normalized':len(ready),'quarantine':len(failed)}))
if __name__=='__main__':main()
