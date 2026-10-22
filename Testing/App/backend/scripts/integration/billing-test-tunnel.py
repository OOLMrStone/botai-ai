#!/usr/bin/env python3
"""Owned loopback-only reverse tunnel. Start only after candidate ingress review."""
import argparse
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
SOCKET = ROOT / 'runtime/billing-test.sock'
HOST = 'ege-server'
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12']


def remote(command):
    result = subprocess.run(SSH + ['-o', 'ControlMaster=no', '-o', 'ControlPath=none', HOST, command], text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise SystemExit('Remote tunnel preflight failed')
    return result.stdout.strip()


def listener():
    return remote("ss -H -ltn 'sport = :18084'")


def owner_alive():
    return subprocess.run(SSH + ['-S', str(SOCKET), '-O', 'check', HOST], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['status', 'start', 'stop'])
parser.add_argument('--reviewed-ingress', action='store_true', help='Operator confirms root reviewed the exact Caddy candidate before starting')
args = parser.parse_args()
if args.action == 'stop':
    if SOCKET.exists() and owner_alive():
        subprocess.run(SSH + ['-S', str(SOCKET), '-O', 'exit', HOST], check=True)
    print('Owned tunnel stopped or already absent; other SSH sessions unchanged')
    raise SystemExit()
settings = remote('sshd -T')
if 'gatewayports no' not in settings.splitlines() or 'disableforwarding no' not in settings.splitlines():
    raise SystemExit('Refusing tunnel: remote GatewayPorts must be no and forwarding enabled')
if not any(line in settings.splitlines() for line in ['allowtcpforwarding yes', 'allowtcpforwarding remote']):
    raise SystemExit('Refusing tunnel: remote forwarding is disabled')
current = listener()
if args.action == 'status':
    print('GatewayPorts=no; remote listener=' + ('absent' if not current else 'loopback' if all(line.split()[3] == '127.0.0.1:18084' for line in current.splitlines()) else 'UNEXPECTED'))
    raise SystemExit()
if not args.reviewed_ingress:
    raise SystemExit('Ingress review is required; no tunnel started')
if current or (SOCKET.exists() and owner_alive()):
    raise SystemExit('Remote port or owned tunnel already active; preserve it')
SOCKET.unlink(missing_ok=True)
command = SSH + ['-M', '-S', str(SOCKET), '-N', '-o', 'ControlPersist=no', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-R', '127.0.0.1:18084:127.0.0.1:18084', HOST]
child = subprocess.Popen(command)


def stop(*_):
    if child.poll() is None:
        child.terminate()


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
try:
    for _ in range(10):
        if child.poll() is not None:
            raise SystemExit('Tunnel failed before listener verification')
        current = listener()
        if current:
            break
        time.sleep(0.5)
    if not current or not all(line.split()[3] == '127.0.0.1:18084' for line in current.splitlines()):
        raise SystemExit('Unexpected reverse listener; shutting down owned tunnel')
    print('Verified remote 127.0.0.1:18084 only; foreground tunnel active (Ctrl-C stops)', flush=True)
    child.wait()
finally:
    stop()
    child.wait(timeout=15)
    SOCKET.unlink(missing_ok=True)
