#!/usr/bin/env python3
"""Start a native portable build in mock mode and check its browser surface."""
from __future__ import annotations

import argparse
from collections import deque
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener
import zlib


def synthetic_png() -> bytes:
    """Create a tiny RGB upload entirely in memory, with no student data."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack('!I', len(data)) + kind + data
                + struct.pack('!I', zlib.crc32(kind + data)))
    pixels = (b'\x00' + b'\xff\xff\xff' * 16) * 16
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('!2I5B', 16, 16, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


def check_mock_grading(opener, base: str) -> None:
    boundary = 'botai-local-native-smoke-boundary'
    image = synthetic_png()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="task_number"\r\n'
            '\r\n16\r\n').encode('ascii') + b''.join(
        (f'--{boundary}\r\n'
         f'Content-Disposition: form-data; name="{field}"; filename="synthetic.png"\r\n'
         'Content-Type: image/png\r\n\r\n').encode('ascii') + image + b'\r\n'
        for field in ('task_image', 'solution_images')
    ) + f'--{boundary}--\r\n'.encode('ascii')
    request = Request(base + '/api/v1/photo-check', data=body, headers={
        'Content-Type': f'multipart/form-data; boundary={boundary}', 'Origin': base,
    }, method='POST')
    with opener.open(request, timeout=20) as response:
        raw = response.read().decode('utf-8')
        result = json.loads(raw)
        request_id = response.headers.get('X-Request-ID')
    if (not request_id or result.get('is_graded') is not True
            or result.get('grading', {}).get('score') != 2
            or result.get('task', {}).get('task_number') != 16
            or len(result.get('solution_image_ids', [])) != 1):
        raise RuntimeError('Native mock grading did not return its expected validated result')
    with opener.open(base + '/local/events', timeout=5) as response:
        events = [event for event in json.load(response)['events']
                  if event.get('request_id') == request_id]
    writes = {
        event['details']['path']: event['details'].get('content')
        for event in events if event.get('kind') == 'artifact' or (event.get('kind') == 'tool_result'
        and event.get('details', {}).get('tool') == 'write_file')
        and event['details'].get('ok') is True
    }
    if not {'ocr_result.md', 'notes.md', 'response.json'} <= writes.keys():
        raise RuntimeError('Native mock diagnostics missed OCR, review, or response writes')
    if writes['response.json'] != raw:
        raise RuntimeError('Native mock response differs from the validated saved JSON')
    if not any(event.get('kind') == 'validation' and event.get('details', {}).get('valid') is True
               for event in events):
        raise RuntimeError('Native mock diagnostics missed successful validation')
    if not any(event.get('kind') == 'final' and event.get('details', {}).get('validated') is True
               for event in events):
        raise RuntimeError('Native mock diagnostics missed the validated final result')


def smoke_test(executable: Path) -> dict:
    executable = executable.resolve(strict=True)
    opener = build_opener(ProxyHandler({}))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    command = [str(executable), "--mock", "--no-browser", "--port", str(port)]
    process = subprocess.Popen(command, cwd=executable.parent, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               start_new_session=os.name != "nt")
    # Keep the tail of native startup diagnostics in memory only. Reading chunks
    # avoids an unbounded line allocation if a bootloader emits a very long line.
    chunks = deque(maxlen=24)
    output_lock = threading.Lock()

    def capture_output():
        try:
            while chunk := process.stdout.read1(4096):
                with output_lock:
                    chunks.append(chunk)
        except (OSError, ValueError):
            pass

    reader = threading.Thread(target=capture_output, daemon=True)
    reader.start()
    failure = None
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 45
        while True:
            if process.poll() is not None:
                raise RuntimeError(f"Native application exited with code {process.returncode}")
            try:
                with opener.open(base + "/local/status", timeout=1) as response:
                    status = json.load(response)
                break
            except (URLError, TimeoutError):
                if time.monotonic() >= deadline:
                    raise RuntimeError("Native application did not start within 45 seconds") from None
                time.sleep(0.2)
        if status.get("mode") != "mock" or status.get("endpoint") != "https://api.deepseek.com/v1":
            raise RuntimeError("Native application reported an unexpected provider configuration")
        with opener.open(base + '/api/v1/photo-check/config', timeout=5) as response:
            catalog = json.load(response)
        tasks = catalog.get('tasks', [])
        expected_scores = {14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4}
        if (len(tasks) != 7 or
                {task.get('task_number'): task.get('max_score') for task in tasks} != expected_scores):
            raise RuntimeError('Native task catalog must describe numbers 14–20 with their score scales')
        selected = next(task for task in tasks if task['task_number'] == 16)
        if selected.get('available') is not True or selected.get('missing_files') != []:
            raise RuntimeError('Native task 16 package must be available for the grading smoke test')
        if set(status.get("prompt_files", {})) != {
            "main.md", "analysis.md", "grading.md", "response-format.md", "ocr.md",
            "ocr_specialties.md", "criteria.md", "popular_mistakes.md",
        }:
            raise RuntimeError("Native application did not load the eight approved prompt files")
        for suffix in ("/ui/?local=1", "/ui/local.js", "/ui/local.css", "/local/events"):
            with opener.open(base + suffix, timeout=5) as response:
                if response.status != 200 or not response.read():
                    raise RuntimeError(f"Missing native browser resource: {suffix}")
        check_mock_grading(opener, base)
    except Exception as error:
        failure = error
    finally:
        if process.poll() is None:
            if os.name == "nt":
                # Terminate the onefile bootloader and its child Python process.
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        reader.join(timeout=2)
        if not reader.is_alive():
            process.stdout.close()
    if failure is not None:
        with output_lock:
            diagnostics = b''.join(chunks).decode('utf-8', errors='replace').strip()[-6000:]
        message = str(failure)
        if diagnostics:
            message += '\nNative process diagnostics:\n' + diagnostics
        raise RuntimeError(message) from failure
    return status


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", nargs="?", type=Path)
    args = parser.parse_args()
    executable = args.executable
    if executable is None:
        name = "BotAI-Local.exe" if os.name == "nt" else "BotAI-Local"
        candidates = list((Path(__file__).resolve().parents[1] / "dist").glob(f"*/{name}"))
        if len(candidates) != 1:
            parser.error("Specify one executable; dist does not contain exactly one native build")
        executable = candidates[0]
    try:
        smoke_test(executable)
    except (OSError, RuntimeError, ValueError) as exc:
        message = f"Native smoke test failed: {exc}"
        print(message, file=sys.stderr)
        if os.environ.get('GITHUB_ACTIONS') == 'true':
            # Escape workflow-command data so a multiline traceback is exposed
            # as one check-run annotation, accessible without downloading logs.
            escaped = message.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
            print(f'::error::{escaped}', flush=True)
        return 1
    print("Native task catalog, browser assets, complete mock grading, and validated event trace passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
