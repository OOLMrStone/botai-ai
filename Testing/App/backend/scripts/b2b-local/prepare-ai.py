#!/usr/bin/env python3
"""Export an explicitly approved clean AI checkout; never refresh implicitly."""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from common import RUNTIME, private_file, verify_export, assert_isolated

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True, help='Approved isolated AI checkout')
parser.add_argument('--approved-head', required=True, help='Full approved 40-character commit SHA')
parser.add_argument('--archive-existing-head', help='Explicitly preserve this exact old accepted export/approval in private history')
args = parser.parse_args()
assert_isolated()
source = args.source.resolve(strict=True)
head = args.approved_head
if len(head) != 40 or any(char not in '0123456789abcdef' for char in head):
    parser.error('Use the full approved commit SHA')
export = RUNTIME / 'ai-export'
approval = RUNTIME / 'ai-approval.json'
previous = None
if export.exists() or export.is_symlink() or approval.exists() or approval.is_symlink():
    if export.is_symlink() or approval.is_symlink() or not export.is_dir() or not approval.is_file():
        raise SystemExit('Unexpected existing export/approval; preserved for review')
    previous = json.loads(approval.read_text())
    if (not args.archive_existing_head or previous.get('approvedHead') != args.archive_existing_head
            or previous.get('exportManifestSha256') != verify_export(export)):
        raise SystemExit('Existing export preserved; exact --archive-existing-head and intact old manifest required')
elif args.archive_existing_head:
    raise SystemExit('Requested old export does not exist; refusing ambiguous refresh')


def source_state():
    current = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True)
    if current != head or dirty:
        raise RuntimeError('AI checkout differs from approved clean head; no checkout changes performed')


source_state()
# Testing/App/backend may live inside the AI checkout. The AI exporter rejects
# any destination beneath its source, so export outside it first and then copy
# the strictly verified payload into the private runtime for an atomic rename.
external = Path(tempfile.mkdtemp(prefix='botai-b2b-ai-export-')).resolve()
if external == source or source in external.parents:
    raise RuntimeError('Temporary export directory must be outside the AI source')
candidate = RUNTIME / ('ai-export-candidate-' + str(time.time_ns()))
subprocess.run([sys.executable, str(source / 'deploy/build_runtime.py'), str(external)], check=True)
digest = verify_export(external)
shutil.copytree(external, candidate)
candidate.chmod(0o700)
if verify_export(candidate) != digest:
    raise RuntimeError('Copied AI export differs; private candidates retained')
source_state()
if previous:
    history = RUNTIME / 'ai-history'
    if history.is_symlink():
        raise RuntimeError('Private AI history symlink forbidden')
    history.mkdir(mode=0o700, exist_ok=True)
    history.chmod(0o700)
    archived = history / (str(time.time_ns()) + '-' + previous['approvedHead'])
    archived.mkdir(mode=0o700)
    # Candidate is fully verified first; old payload and its exact approval are retained together.
    export.rename(archived / 'ai-export')
    approval.rename(archived / 'ai-approval.json')
    private_file(archived / 'history.json', json.dumps({'replacedBy': head,
        'previousHead': previous['approvedHead'], 'previousManifestSha256': previous['exportManifestSha256']}, indent=2) + '\n')
candidate.rename(export)
private_file(approval, json.dumps({'source': str(source), 'approvedHead': head,
                                  'exportManifestSha256': digest,
                                  'mode': 'mock', 'createdAtNs': time.time_ns()}, indent=2) + '\n')
shutil.rmtree(external)
print('Approved AI runtime exported and verified; no build, startup, readiness probe or model call.')
