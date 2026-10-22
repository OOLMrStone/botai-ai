#!/usr/bin/env python3
"""Create a code-only stage archive. No credentials, research or student uploads."""
import argparse,datetime,hashlib,json,os,tarfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path);args=parser.parse_args()
values=dict(line.split('=',1) for line in (root/'runtime/.env.integration').read_text().splitlines() if line and not line.startswith('#'))
ai=Path(values['AI_CONTEXT']);front=root.parent/'botai-front'
manifest=json.loads((ai/'manifest.json').read_text())
for path,digest in manifest['files'].items():
    source=ai/path
    if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest()!=digest:raise SystemExit('AI runtime manifest mismatch')
dest=args.output or root/'runtime/evidence'/('stage-source-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.tgz')
dest.parent.mkdir(parents=True,exist_ok=True);dest.parent.chmod(0o700)
files={}
def collect(base,prefix,paths):
    for path in paths:
        if path.is_symlink():raise SystemExit('Symlink in stage code input: '+str(path))
        candidates=path.rglob('*') if path.is_dir() else [path]
        for file in candidates:
            relative=file.relative_to(base)
            if any(part.startswith('.env') or part in {'__pycache__','.git','node_modules','.next','.DS_Store','research','uploads'} for part in relative.parts):continue
            if file.is_symlink():raise SystemExit('Symlink in stage code input: '+str(file))
            if file.is_file():files[prefix+'/'+relative.as_posix()]=file
collect(root,'back',[root/name for name in ['gradlew','gradle','src','build.gradle.kts','settings.gradle.kts','Dockerfile.integration','.dockerignore','compose.integration.yaml','compose.stage.yaml','scripts/integration','docs/integration']])
front_files=['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs','eslint.config.mjs','components.json','.prettierrc.json','Dockerfile.integration','.dockerignore']
collect(front,'front',[front/name for name in front_files if (front/name).exists()]+[front/name for name in ['src','public','scripts']])
collect(ai,'ai',[ai/name for name in manifest['files']]+[ai/'manifest.json'])
with tarfile.open(dest,'w:gz') as archive:
    for name,path in sorted(files.items()):archive.add(path,arcname=name,recursive=False)
dest.chmod(0o600)
metadata={'archive':dest.name,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'files':len(files),'aiManifestFiles':len(manifest['files']),'containsCredentials':False,'sourceReady':'Requires final frontend freeze/build before server deployment'}
(dest.with_suffix('.json')).write_text(json.dumps(metadata,indent=2)+'\n');dest.with_suffix('.json').chmod(0o600)
print(json.dumps(metadata))
