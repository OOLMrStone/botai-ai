#!/usr/bin/env python3
"""Owned foreground SSH preview tunnel; bounded reconnects, no server changes."""
import signal,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[2];socket=root/'runtime/stage-tunnel.sock'
command=['ssh','-M','-S',str(socket),'-N','-o','BatchMode=yes','-o','ConnectTimeout=12','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3']
for local,remote in [(23000,13000),(28082,18082),(28090,18090),(28025,18025)]:command+=['-L',f'localhost:{local}:127.0.0.1:{remote}']
command+=['ege-server'];child=None;stopping=False
def stop(*_):
    global stopping
    stopping=True
    if child and child.poll() is None:child.terminate()
signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
failures=0
while not stopping:
    if socket.exists():
        check=subprocess.run(['ssh','-S',str(socket),'-O','check','ege-server'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if check.returncode==0:raise SystemExit('Existing owned tunnel is alive; preserve it')
        socket.unlink(missing_ok=True)
    started=time.monotonic();print('Starting owned localhost stage preview tunnel',flush=True)
    child=subprocess.Popen(command);child.wait()
    if stopping:break
    failures=0 if time.monotonic()-started>60 else failures+1
    if failures>=3:raise SystemExit('Three bounded SSH tunnel failures; inspect connectivity before retrying')
    delay=[5,15,30][min(failures,2)];print(f'Tunnel disconnected; reconnect after {delay}s',flush=True)
    for _ in range(delay):
        if stopping:break
        time.sleep(1)
socket.unlink(missing_ok=True)
