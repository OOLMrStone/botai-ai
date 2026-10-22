#!/usr/bin/env python3
"""Prepare explicit private live controls or switch only an accepted, idle B2B runtime."""
import argparse
import json
import os
import subprocess
import sys
import uuid
from common import (ROOT, RUNTIME, COMPOSE, assert_isolated, assert_local_docker,
                    private_file, verify_export, db, PROJECT)
from provenance import verify_proof, running_ids, image_override, write_state

OVERRIDE = RUNTIME / 'live.compose.json'
MODE = RUNTIME / 'provider-mode.json'
SWITCH = RUNTIME / 'provider-switch.json'


def prepare():
    keyfile = RUNTIME / 'provider-key.json'
    profile = RUNTIME / 'provider-profile.json'
    for path in (keyfile, profile):
        if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
            raise RuntimeError('Private key and approved public provider profile required')
    key = json.loads(keyfile.read_text()).get('apiKey')
    public = json.loads(profile.read_text())
    if (not isinstance(key, str) or not key or any(c.isspace() for c in key)
            or public.get('baseUrl') != 'https://api.deepseek.com/v1'
            or not isinstance(public.get('model'), str) or not public['model']
            or public.get('timeoutSeconds') != 360 or public.get('maxOutputTokens') != 32000):
        raise RuntimeError('Provider profile does not match the authorized local configuration')
    value = {'services': {
        'ai': {'environment': {'LLM_PROVIDER': 'openai', 'LLM_VISION_PROVIDER': 'openai',
            'LLM_API_KEY': key, 'LLM_BASE_URL': public['baseUrl'], 'LLM_MODEL': public['model'],
            'LLM_TIMEOUT_S': '360', 'LLM_MAX_OUTPUT_TOKENS': '32000', 'LLM_MAX_RETRIES': '0',
            'LOCAL_DEMO_AI_ALLOW_LIVE': 'true'}, 'networks': ['grading', 'provider']},
        'backend': {'environment': {'APP_B2B_ALLOW_LIVE': 'true', 'APP_EXPERT_GRADING_ALLOW_LIVE': 'true'}}},
        'networks': {'provider': {}}}
    text = json.dumps(value, indent=2) + '\n'
    if OVERRIDE.is_symlink() or (OVERRIDE.exists() and OVERRIDE.read_text() != text):
        raise RuntimeError('Existing private live override differs; preserved for review')
    private_file(OVERRIDE, text)


def idle(mode):
    states = "'queued','pending','unknown'" if mode == 'live' else "'queued','pending'"
    count = db("SELECT (SELECT count(*) FROM grading_submissions WHERE status IN('queued','running'))"
               "+(SELECT count(*) FROM expert_grading_jobs WHERE state IN(" + states + "));", query=True)
    if count != '0':
        raise RuntimeError('B2B queued/running/unknown work exists; do not change provider during a run')


def stop_owned():
    """Best effort stop, but never mistake a CLI failure for confirmed containment."""
    try:
        subprocess.run([str(COMPOSE), 'stop', '--timeout', '15', 'backend', 'ai'], capture_output=True)
    except BaseException:
        pass
    stopped = True
    for service in ('backend', 'ai'):
        try:
            result = subprocess.run(['docker', 'ps', '-q', '--filter',
                'label=com.docker.compose.project=' + PROJECT, '--filter',
                'label=com.docker.compose.service=' + service], capture_output=True, text=True)
            stopped = stopped and result.returncode == 0 and not result.stdout.strip()
        except BaseException:
            stopped = False
    return stopped


def apply(mode, accepted_head):
    assert_local_docker()
    proof_path = RUNTIME / ('accepted-build.json' if mode == 'live' else 'build-proof.json')
    if mode == 'mock' and (RUNTIME / 'accepted-build.json').is_file():
        proof_path = RUNTIME / 'accepted-build.json'
    if proof_path.is_symlink() or not proof_path.is_file():
        raise RuntimeError('Reviewed immutable image provenance required before provider switching')
    proof = verify_proof(json.loads(proof_path.read_text()), current_source=mode == 'live')
    if mode == 'live':
        if proof.get('securityReviewed') is not True or running_ids() != proof['images']:
            raise RuntimeError('Security-reviewed build and actual running images must agree before live enablement')
        approval = RUNTIME / 'ai-approval.json'
        if (approval.is_symlink() or not approval.is_file() or not (RUNTIME / 'fixtures.json').is_file()):
            raise RuntimeError('Accepted AI export and completed school seed required before live enablement')
        approved = json.loads(approval.read_text())
        if (not accepted_head or approved.get('approvedHead') != accepted_head
                or len(accepted_head) != 40
                or approved.get('exportManifestSha256') != verify_export(RUNTIME / 'ai-export')):
            raise RuntimeError('Explicit accepted AI head and export integrity are required')
        prepare()
    subprocess.run([sys.executable, str(ROOT / 'scripts/b2b-local/check.py'), '--mode', mode], check=True)
    idle(mode)
    pins = image_override(proof, RUNTIME / 'switch-images.compose.json')
    attempt = {'attemptId': uuid.uuid4().hex, 'state': 'switching', 'targetMode': mode,
               'expectedImages': proof['images'], 'aiHead': proof['aiHead']}
    write_state(SWITCH, attempt)
    try:
        # Freeze admission/workers, then check again so a last-moment enqueue cannot switch providers.
        subprocess.run([str(COMPOSE), 'stop', 'backend'], check=True)
        idle(mode)
        verify_proof(proof, current_source=mode == 'live')
        command = ([str(COMPOSE)] + (['-f', str(OVERRIDE)] if mode == 'live' else [])
                   + ['-f', str(pins)])
        for service in ('ai', 'backend'):
            subprocess.run(command + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait',
                                       '--wait-timeout', '120', service], check=True)
        verify_proof(proof, current_source=mode == 'live')
        if running_ids() != proof['images']:
            raise RuntimeError('Actual running image IDs differ after switch')
        # State persistence is part of the mutation: disk errors or Ctrl-C here must contain live services.
        write_state(MODE, {'mode': mode, 'aiHead': proof['aiHead'], 'images': proof['images']})
        write_state(SWITCH, {**attempt, 'state': 'succeeded'})
    except BaseException:
        stopped = stop_owned()
        # Containment precedes persistence. If disk writes fail, the prewritten switching marker remains.
        for path, value in ((SWITCH, {**attempt, 'state': 'failed_stopped' if stopped else 'unknown_running',
                                      'stoppedConfirmed': stopped}),
                            (MODE, {'mode': 'unknown', 'switchAttempt': attempt['attemptId']})):
            try:
                write_state(path, value)
            except BaseException:
                pass
        print('Provider switch failed; owned AI/backend stop confirmed: ' + str(stopped).lower()
              + '. Failure marker retained; explicit mock reconciliation required.', file=sys.stderr)
        raise
    print('B2B provider mode applied: ' + mode + '. Only AI/backend recreated; no model request dispatched.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('status', 'prepare-live', 'enable-live', 'disable-live'))
    parser.add_argument('--apply', action='store_true', help='Explicitly recreate only accepted, idle B2B AI/backend')
    parser.add_argument('--accepted-head', help='Full accepted AI SHA, required to apply live mode')
    args = parser.parse_args()
    assert_isolated()
    if args.action == 'status':
        mode = json.loads(MODE.read_text()).get('mode') if MODE.is_file() and not MODE.is_symlink() else 'mock (default/unapplied)'
        print('Recorded provider mode: ' + str(mode) + '; private live override prepared: ' + str(OVERRIDE.is_file()).lower())
        print('This is saved configuration, not a claim about running containers.')
        return
    if args.action == 'prepare-live':
        if args.apply:
            parser.error('prepare-live never applies runtime changes')
        prepare()
        print('Private live override prepared0600; not loaded, mock defaults unchanged, no Docker/model call.')
        return
    if not args.apply:
        parser.error('Runtime changes require explicit --apply; use prepare-live for preparation only')
    apply('live' if args.action == 'enable-live' else 'mock', args.accepted_head)


if __name__ == '__main__':
    main()
