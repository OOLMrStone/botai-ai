"""Bind immutable Docker image IDs to the sources and export actually built locally."""
import datetime
import hashlib
import json
import os
import subprocess
import uuid
from common import ROOT, RUNTIME, PROJECT, COMPOSE, private_file, verify_export

SERVICES = ('ai', 'backend', 'pdf-renderer')


def write_state(path, data):
    if path.is_symlink():
        raise RuntimeError('Private state symlink forbidden')
    temporary = RUNTIME / ('.state-' + uuid.uuid4().hex)
    private_file(temporary, json.dumps(data, indent=2) + '\n')
    os.replace(temporary, path)


def digest(paths):
    files = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in sorted(set(paths)) if path.is_file()}
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def backend_source():
    renderer = [path for path in ROOT.glob('renderer/pdf/**/*')
                if not {'build', '.gradle', '__pycache__', '.DS_Store'} & set(path.relative_to(ROOT / 'renderer/pdf').parts)]
    return digest([*ROOT.glob('src/**/*'), *renderer, ROOT / 'Dockerfile.integration', ROOT / '.dockerignore',
        ROOT / 'gradlew', *ROOT.glob('gradle/**/*'), ROOT / 'build.gradle.kts', ROOT / 'settings.gradle.kts'])


def controls_source():
    return digest([*ROOT.glob('scripts/b2b-local/*.py'), *ROOT.glob('scripts/b2b-local/*.sh'),
                   ROOT / 'compose.b2b-local.yaml'])


def image_ids():
    return {service: subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}',
        PROJECT + '-' + service], text=True).strip() for service in SERVICES}


def running_ids():
    result = {}
    for service in SERVICES:
        ids = subprocess.check_output([str(COMPOSE), 'ps', '-q', service], text=True).split()
        if len(ids) != 1:
            raise RuntimeError('Expected exactly one healthy owned service')
        value = subprocess.check_output(['docker', 'inspect', '--format',
            '{{.Image}} {{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', ids[0]], text=True).strip().split()
        if len(value) != 3 or value[1:] != ['true', 'healthy']:
            raise RuntimeError('Owned service is not healthy')
        result[service] = value[0]
    return result


def verify_proof(proof, *, current_source=True):
    approval = json.loads((RUNTIME / 'ai-approval.json').read_text())
    if (proof.get('schemaVersion') != 1 or proof.get('aiHead') != approval.get('approvedHead')
            or proof.get('aiExportManifestSha256') != verify_export(RUNTIME / 'ai-export')
            or proof.get('aiExportManifestSha256') != approval.get('exportManifestSha256')
            or set(proof.get('images', {})) != set(SERVICES)):
        raise RuntimeError('Accepted build/export provenance mismatch')
    if current_source and (proof.get('backendSourceSha256') != backend_source()
                           or proof.get('runtimeControlsSha256') != controls_source()):
        raise RuntimeError('Backend/runtime sources differ from accepted build')
    for service, expected in proof['images'].items():
        actual = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', expected], text=True).strip()
        if actual != expected or not expected.startswith('sha256:'):
            raise RuntimeError('Accepted immutable image missing')
    return proof


def record_build(before):
    if before != backend_source():
        raise RuntimeError('Backend source changed during build; do not start this candidate')
    approval = json.loads((RUNTIME / 'ai-approval.json').read_text())
    proof = {'schemaVersion': 1, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'aiHead': approval['approvedHead'], 'aiExportManifestSha256': verify_export(RUNTIME / 'ai-export'),
        'backendSourceSha256': before, 'runtimeControlsSha256': controls_source(), 'images': image_ids()}
    verify_proof(proof)
    write_state(RUNTIME / 'build-proof.json', proof)
    return proof


def image_override(proof, path):
    write_state(path, {'services': {service: {'image': image, 'pull_policy': 'never'}
                                    for service, image in proof['images'].items()}})
    return path
