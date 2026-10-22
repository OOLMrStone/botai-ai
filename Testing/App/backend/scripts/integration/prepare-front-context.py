#!/usr/bin/env python3
"""Immutable approved frontend source snapshot, excluding local/private artifacts."""
import argparse,hashlib,json,shutil
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--expected-sha256',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[2];front=root.parent/'botai-front';dest=root/'runtime/evidence/front-context-final'
config=['package.json','package-lock.json','next.config.ts','Dockerfile.integration','.dockerignore','tsconfig.json','postcss.config.mjs','components.json','eslint.config.mjs','.prettierrc.json','.npmrc']
files=[f.relative_to(front) for name in ['src','public','scripts'] for f in (front/name).rglob('*') if f.is_file()]+[Path(name) for name in config if (front/name).is_file()]
files=sorted(files);h=hashlib.sha256()
for name in files:
    source=front/name
    if source.is_symlink() or any(v in name.parts for v in ['.dev-data','node_modules','.next','research','uploads']) or any(v.startswith('.env') for v in name.parts):raise SystemExit('Forbidden source context entry')
    h.update(str(name).encode()+b'\0'+source.read_bytes()+b'\0')
if h.hexdigest()!=a.expected_sha256:raise SystemExit('Source changed or manifest differs; preserve active images and obtain final freeze')
if dest.exists():shutil.rmtree(dest)
dest.mkdir(mode=0o700,parents=True)
for name in files:
    out=dest/name;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(front/name,out)
captured=hashlib.sha256()
for name in files:captured.update(str(name).encode()+b'\0'+(dest/name).read_bytes()+b'\0')
if captured.hexdigest()!=h.hexdigest():raise SystemExit('Source changed during snapshot; do not build/deploy this context')
manifest=root/'runtime/evidence/frontend-final-manifest.json' ;manifest.write_text(json.dumps({'sha256':h.hexdigest(),'files':[str(v) for v in files]},indent=2)+'\n');manifest.chmod(0o600)
print(f'Approved frontend snapshot PASS:{len(files)} files; {h.hexdigest()}')
