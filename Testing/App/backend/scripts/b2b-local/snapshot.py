#!/usr/bin/env python3
"""Record source and actual B2B image IDs without environment or private content."""
import datetime
import hashlib
import json
import subprocess
from common import ROOT, RUNTIME, PROJECT, assert_isolated, assert_local_docker, private_file, verify_export

assert_isolated()
assert_local_docker()
sources = [*ROOT.glob('src/main/**/*'), *ROOT.glob('renderer/pdf/src/main/**/*'),
           *ROOT.glob('scripts/b2b-local/*.py'), *ROOT.glob('scripts/b2b-local/*.sh'),
           ROOT / 'compose.b2b-local.yaml', ROOT / '.dockerignore', ROOT / 'Dockerfile.integration',
           ROOT / 'build.gradle.kts', ROOT / 'settings.gradle.kts', ROOT / 'gradlew',
           ROOT / 'gradle/wrapper/gradle-wrapper.jar', ROOT / 'gradle/wrapper/gradle-wrapper.properties',
           ROOT / 'renderer/pdf/build.gradle.kts', ROOT / 'renderer/pdf/settings.gradle.kts',
           ROOT / 'renderer/pdf/Dockerfile']
manifest = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(sources) if path.is_file()}
ids = subprocess.check_output(['docker', 'ps', '-aq', '--filter',
                               'label=com.docker.compose.project=' + PROJECT], text=True).split()
running = {}
for container in ids:
    # Named fields only: never dump Config.Env or the complete inspect document.
    output = subprocess.check_output(['docker', 'inspect', '--format',
        '{{index .Config.Labels "com.docker.compose.service"}} {{.Image}} {{.State.Status}}', container], text=True)
    service, image, status = output.strip().split()
    running[service] = {'imageId': image, 'state': status}
result = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'sourceSha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
          'sources': manifest, 'containers': running,
          'aiApproval': json.loads((RUNTIME / 'ai-approval.json').read_text()),
          'aiExportManifestSha256': verify_export(RUNTIME / 'ai-export'),
          'evidenceSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in sorted(set(RUNTIME.glob('*evidence.json')) | set(RUNTIME.glob('read-evidence-*.json')))}}
filename = 'snapshot-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json'
private_file(RUNTIME / filename, json.dumps(result, indent=2) + '\n')
print('Private B2B snapshot recorded; source SHA256 ' + result['sourceSha256'])
