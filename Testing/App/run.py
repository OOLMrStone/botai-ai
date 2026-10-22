#!/usr/bin/env python3
"""Run the three B2B sites from one botai-ai main checkout; no secrets are bundled."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

APP = Path(__file__).resolve().parent
AI = APP.parents[1]


def run(args, *, cwd=None, capture=False, data=None):
    return subprocess.run([str(x) for x in args], cwd=cwd, check=True,
                          input=data, stdout=subprocess.PIPE if capture else None)


def git(repo, *args):
    return run(['git', '-C', repo, *args], capture=True).stdout.decode().strip()


def backend_script(name, *args):
    run([sys.executable, BACK / 'scripts/b2b-local' / name, *args], cwd=BACK)


def require_clean(repo):
    if git(repo, 'status', '--porcelain'):
        raise SystemExit(f'Checkout has local changes; preserve it and use a fresh clone: {repo}')


def guard_project_owner():
    """Do not replace/stop another checkout's containers sharing a project name."""
    if not shutil.which('docker'):
        raise SystemExit('Install Docker and start its local daemon; see Testing/App/prompt.md.')
    project = 'botai-b2b-local' + ('' if ARGS.instance == 'default' else '-partner-check')
    ids = run(['docker', 'ps', '-aq', '--filter',
               'label=com.docker.compose.project=' + project], capture=True).stdout.decode().split()
    for container in ids:
        owner = run(['docker', 'inspect', '--format',
                     '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}',
                     container], capture=True).stdout.decode().strip()
        if not owner or Path(owner).resolve() != BACK.resolve():
            raise SystemExit('This Compose project belongs to a different checkout. '
                             'Existing services were preserved; use its checkout or an unused profile.')


def read_json(path):
    return json.loads(path.read_text())


def private_write(path, value):
    if path.is_symlink():
        raise SystemExit(f'Refusing symlink: {path}')
    raw = value if isinstance(value, bytes) else value.encode()
    if path.exists():
        if path.read_bytes() != raw:
            raise SystemExit(f'Existing file differs and was preserved: {path}')
        return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('xb') as stream:
        path.chmod(0o600)
        stream.write(raw)


def fixtures():
    """Only public FIPI input images; never load expected scores/verdicts."""
    source = AI / 'Testing/evals/14/fipi'
    target = RUNTIME / 'partner-seed'
    reference = (source / 'problems/13.3.png').read_bytes()
    image_id = read_json(RUNTIME / 'build-proof.json')['images']['ai']
    crop = ('import sys; from io import BytesIO; from PIL import Image; '
            'im=Image.open(BytesIO(sys.stdin.buffer.read())); '
            'assert im.size==(1074,219); '
            'out=BytesIO(); im.crop((0,0,1074,130)).save(out,format="PNG"); '
            'sys.stdout.buffer.write(out.getvalue())')
    statement = run(['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only',
                     '--entrypoint', 'python', image_id, '-c', crop], capture=True, data=reference).stdout
    private_write(target / 'statement.png', statement)
    private_write(target / 'reference.png', reference)
    private_write(target / 'solution.png', (source / '13.3.2/solution.png').read_bytes())
    manifest = {'version': 1, 'source': 'Public FIPI 2026 methodical recommendations, page 24',
      'cases': [{'id': 'fipi-13.3.2', 'projectNumber': 14, 'fipiId': '13.3.2', 'sourcePage': 24,
        'title': 'ФИПИ 13.3.2 — сокращение π', 'maxScore': 2,
        'statementText': 'а) Решите уравнение sin x · cos 2x + √2 cos²x + sin x = 0.\n'
                         'б) Укажите корни, принадлежащие отрезку [3π/2; 3π].',
        'referenceAnswer': 'а) π/2 + πk; −π/4 + 2πn; −3π/4 + 2πm, k,n,m ∈ Z. '
                           'б) 3π/2; 7π/4; 5π/2.',
        'referenceSolution': None, 'files': {'statement': 'statement.png',
          'taskReference': 'reference.png', 'studentSolution': 'solution.png'}}]}
    private_write(target / 'manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    backend_script('prepare-fixtures.py', '--manifest', target / 'manifest.json')


def urls():
    for host, path in [('student', '/school'), ('expert', '/grade'), ('dev', '/grade/dev')]:
        print(f'http://{host}.localhost:{PORT}{path}', flush=True)
    print(f'Login credentials: {RUNTIME / "credentials.json"}', flush=True)


def up():
    for binary in ('git', 'docker', 'node', 'npm'):
        if not shutil.which(binary):
            raise SystemExit(f'Install prerequisite: {binary}; see Testing/App/prompt.md')
    require_clean(AI)
    backend_script('init.py')
    mode = RUNTIME / 'provider-mode.json'
    if mode.exists() and read_json(mode).get('mode') != 'mock':
        raise SystemExit('Existing live/unknown environment preserved. Use frontend to resume UI, '
                         'or follow the explicit mock recovery instructions in Testing/App/prompt.md.')
    head = git(AI, 'rev-parse', 'HEAD')
    approval = RUNTIME / 'ai-approval.json'
    if not approval.exists():
        backend_script('prepare-ai.py', '--source', AI, '--approved-head', head)
    elif read_json(approval).get('approvedHead') != head:
        raise SystemExit('Existing AI export differs. Follow the documented export refresh; no data was replaced.')
    backend_script('start.py')
    if not (RUNTIME / 'fixtures.json').exists():
        fixtures()
        backend_script('seed.py')
    # Seed records the local operator ID in the private environment. Recreate to load it.
    run([BACK / 'scripts/b2b-local/compose.sh', '-f', RUNTIME / 'mock-images.compose.json',
         'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait', 'backend'])
    backend_script('smoke-read.py')
    print('Backend ready in MOCK mode. No paid model calls have been made.', flush=True)
    frontend()


def frontend():
    if not (FRONT / 'node_modules/.package-lock.json').exists():
        subprocess.run(['npm', 'ci'], cwd=FRONT,
                       env={**os.environ, 'HUSKY': '0'}, check=True)
    urls()
    env = os.environ.copy()
    env.update(NEXT_DIST_DIR='.next-partner-local', BACKEND_URL=f'http://127.0.0.1:{API_PORT}')
    print('Keep this terminal open. Ctrl+C stops the frontend; backend data remains saved.', flush=True)
    subprocess.run(['npm', 'run', 'dev:api', '--', '--webpack', '--hostname', '127.0.0.1',
                    '--port', str(PORT)], cwd=FRONT, env=env, check=True)


def verify():
    backend_script('check.py')
    backend_script('smoke-read.py')
    run([sys.executable, APP / 'verify_flow.py', '--backend', BACK])
    urls()


def live():
    if not ARGS.accept_paid_requests:
        raise SystemExit('Use enable-live --accept-paid-requests only if you want real billed checks.')
    proof = read_json(RUNTIME / 'build-proof.json')
    receipt = read_json(RUNTIME / 'partner-mock-verification.json')
    if receipt.get('images') != proof['images'] or not receipt.get('passed'):
        raise SystemExit('Run verify on this exact mock build before enabling live.')
    backend_script('smoke-read.py')
    backend_script('accept-build.py', '--accepted-ai-head', proof['aiHead'],
                   '--accepted-backend-source-sha256', proof['backendSourceSha256'], '--security-reviewed')
    backend_script('set-provider-key.py')
    private_write(RUNTIME / 'provider-profile.json', json.dumps({
        'baseUrl': 'https://api.deepseek.com/v1', 'model': 'deepseek-flash',
        'timeoutSeconds': 360, 'maxOutputTokens': 32000}, indent=2) + '\n')
    backend_script('provider-mode.py', 'prepare-live')
    backend_script('provider-mode.py', 'enable-live', '--apply', '--accepted-head', proof['aiHead'])
    print('Live enabled. New UI checks can now incur provider charges; no model call was made by this command.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['up', 'frontend', 'verify', 'credentials', 'enable-live', 'stop'])
    parser.add_argument('--instance', choices=['default', 'partner-check'], default='default')
    parser.add_argument('--accept-paid-requests', action='store_true')
    ARGS = parser.parse_args()
    os.environ['B2B_LOCAL_INSTANCE'] = ARGS.instance
    BACK, FRONT = APP / 'backend', APP / 'frontend'
    suffix = '' if ARGS.instance == 'default' else '-partner-check'
    RUNTIME = BACK / ('runtime/b2b-local' + suffix)
    PORT, API_PORT = (13004, 18086) if ARGS.instance == 'default' else (13014, 18096)
    try:
        if ARGS.action != 'credentials':
            guard_project_owner()
        if ARGS.action == 'credentials':
            if not sys.stdout.isatty():
                raise SystemExit('Display passwords only in your interactive terminal; do not paste them into chat.')
            print((RUNTIME / 'credentials.json').read_text())
        elif ARGS.action == 'stop':
            run([BACK / 'scripts/b2b-local/compose.sh', 'stop'])
        else:
            {'up': up, 'frontend': frontend, 'verify': verify, 'enable-live': live}[ARGS.action]()
    except KeyboardInterrupt:
        print('\nFrontend stopped; backend and data preserved.')
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f'Command failed (exit {exc.returncode}); resolve the reported prerequisite before retrying.') from None
