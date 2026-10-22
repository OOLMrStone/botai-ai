#!/usr/bin/env python3
"""Record source/image digests and private smoke evidence without env values."""
import argparse
import datetime
import hashlib
import json
import subprocess
from common import ROOT, RUNTIME

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--phase', choices=('initial', 'nested', 'final', 'pdf'), required=True)
args = parser.parse_args()
files = sorted([*ROOT.glob('src/main/**/*'), ROOT / 'build.gradle.kts', ROOT / 'settings.gradle.kts',
                ROOT / 'Dockerfile.integration', ROOT / '.dockerignore', ROOT / 'gradlew',
                ROOT / 'gradle/wrapper/gradle-wrapper.properties', ROOT / 'gradle/wrapper/gradle-wrapper.jar',
                ROOT / 'compose.expert-local.yaml', *ROOT.glob('renderer/pdf/src/main/**/*'),
                ROOT / 'renderer/pdf/build.gradle.kts', ROOT / 'renderer/pdf/settings.gradle.kts', ROOT / 'renderer/pdf/Dockerfile'])
manifest = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files if path.is_file()}
digest = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
images = {service: subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'botai-expert-local-' + service], text=True).strip()
          for service in ('backend', 'ai', 'pdf-renderer')}
running_images = {service: subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', 'botai-expert-local-' + service + '-1'], text=True).strip()
                  for service in ('backend', 'ai', 'pdf-renderer')}
evidence = RUNTIME / 'smoke-evidence.json'
result = {'phase': args.phase, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sourceSha256': digest, 'sources': manifest, 'images': images, 'runningContainerImageIds': running_images,
          'aiExportManifestSha256': hashlib.sha256((RUNTIME / 'ai-export/manifest.json').read_bytes()).hexdigest(),
          'smokeEvidenceSha256': hashlib.sha256(evidence.read_bytes()).hexdigest() if evidence.exists() else None,
          'pdfSmokeEvidenceSha256': hashlib.sha256((RUNTIME / 'pdf-smoke-evidence.json').read_bytes()).hexdigest() if (RUNTIME / 'pdf-smoke-evidence.json').exists() else None}
output = RUNTIME / (args.phase + '-snapshot.json')
output.write_text(json.dumps(result, indent=2) + '\n')
output.chmod(0o600)
print(f'{args.phase} snapshot recorded; source SHA256 {digest}')
