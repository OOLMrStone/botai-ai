#!/usr/bin/env python3
"""Validate effective sandbox boundaries without starting or modifying services."""
import json
import argparse
import subprocess
from common import (COMPOSE, PROJECT, DATABASE, RUNTIME, FRONTEND_URL, API_PORT,
                    MAIL_PORT, assert_isolated, credentials)

assert_isolated()
credentials()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mode', choices=('mock', 'live'), default='mock')
args = parser.parse_args()
command = [str(COMPOSE)]
if args.mode == 'live':
    override = RUNTIME / 'live.compose.json'
    if override.is_symlink() or not override.is_file() or override.stat().st_mode & 0o077:
        raise SystemExit('Private prepared live override required')
    command += ['-f', str(override)]
result = subprocess.run(command + ['config', '--format', 'json'], capture_output=True, text=True)
if result.returncode:
    raise SystemExit('Compose validation failed; secret-bearing diagnostics withheld')
config = json.loads(result.stdout)
services = config['services']
assert config['name'] == PROJECT
assert set(services) == {'postgres', 'garage', 'mailpit', 'ai', 'pdf-renderer', 'backend'}
assert services['postgres']['environment']['POSTGRES_DB'] == DATABASE
backend = services['backend']['environment']
assert backend['SPRING_DATASOURCE_URL'] == 'jdbc:postgresql://postgres:5432/' + DATABASE
assert backend['SERVER_SERVLET_SESSION_COOKIE_NAME'] == 'B2B_SESSION'
assert backend['SESSION_COOKIE_SECURE'] == 'false'
assert backend['APP_BILLING_MODE'] == 'disabled'
assert backend['APP_B2B_LOCAL_ENABLED'] == 'true'
live_flag = 'true' if args.mode == 'live' else 'false'
assert backend['APP_B2B_ALLOW_LIVE'] == backend['APP_EXPERT_GRADING_ALLOW_LIVE'] == live_flag
assert backend['FRONTEND_BASE_URL'] == FRONTEND_URL
ai = services['ai']['environment']
assert ai['LLM_PROVIDER'] == ai['LLM_VISION_PROVIDER'] == ('openai' if args.mode == 'live' else 'mock')
assert ai['APP_ENV'] == 'local' and ai['APP_CORS_ORIGINS'] == ''
assert ai['LOCAL_DEMO_AI_ENABLED'] == 'true' and ai['LOCAL_DEMO_AI_ALLOW_LIVE'] == live_flag
assert ai['INTERNAL_GRADING_ENABLED'] == 'false' and bool(ai['INTERNAL_GRADING_TOKEN'])
assert ai['LLM_MAX_RETRIES'] == '0'
assert ai['PHOTO_CONCURRENCY'] == services['backend']['environment']['APP_B2B_AI_CONCURRENCY']
assert ai['PHOTO_CONCURRENCY'].isdigit() and 1 <= int(ai['PHOTO_CONCURRENCY']) <= 8
assert ai['DEBUG_ENABLED'] == ai['DEBUG_ALLOW_IN_PROD'] == 'false'
if args.mode == 'live':
    assert bool(ai.get('LLM_API_KEY'))
    assert ai['LLM_BASE_URL'] == 'https://api.deepseek.com/v1'
    assert ai['LLM_MAX_OUTPUT_TOKENS'] == '32000' and ai['LLM_TIMEOUT_S'] == '360'
else:
    assert not any(ai.get(key) for key in ('LLM_API_KEY', 'LLM_VISION_API_KEY', 'OPENAI_API_KEY'))
expected_ports = {'backend': {(API_PORT, 8080)}, 'mailpit': {(MAIL_PORT, 8025)}}
for name, service in services.items():
    ports = service.get('ports', [])
    assert all(port.get('host_ip') == '127.0.0.1' for port in ports)
    assert {(int(port['published']), int(port['target'])) for port in ports} == expected_ports.get(name, set())
assert all(config['networks'][name]['internal'] for name in ('data', 'grading', 'pdf'))
assert set(services['ai']['networks']) == ({'grading', 'provider'} if args.mode == 'live' else {'grading'})
assert set(services['pdf-renderer']['networks']) == {'pdf'}
# Optional operator profile is checked separately; it is not a running application service.
operator_result = subprocess.run([str(COMPOSE), '--profile', 'ops', 'config', '--format', 'json'],
                                 capture_output=True, text=True)
if operator_result.returncode:
    raise SystemExit('Operator Compose validation failed; diagnostics withheld')
operator_config = json.loads(operator_result.stdout)
operator = operator_config['services']['asset-seed']
assert set(operator['networks']) == {'data'} and not operator.get('ports')
assert operator['pull_policy'] == 'never' and operator['read_only']
assert set(operator['environment']) == {'PYTHONDONTWRITEBYTECODE', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'}
assert not any(mount.get('read_only') is False for mount in operator.get('volumes', []))
for service in ('ai', 'backend', 'pdf-renderer'):
    assert services[service]['read_only'] and services[service]['cap_drop'] == ['ALL']
for name in ('postgres-data', 'garage-meta', 'garage-data', 'mailpit-data', 'ai-diagnostics'):
    assert config['volumes'][name]['name'].startswith(PROJECT + '_')
assert RUNTIME.stat().st_mode & 0o077 == 0
for name in ('.env', 'credentials.json', 'garage.toml', 'ISOLATED_B2B_LOCAL'):
    path = RUNTIME / name
    assert not path.is_symlink() and path.stat().st_mode & 0o077 == 0
print('PASS: fixed B2B project/DB, private files, loopback ports, ' + args.mode + ' controls, isolated networks/volumes; no services changed.')
