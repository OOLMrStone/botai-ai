"""Bounded, offline KaTeX parser; validates presentation without rewriting mathematics."""
import asyncio
import json
from pathlib import Path
import shutil
from weakref import WeakKeyDictionary

from app.core.errors import ServiceError

SCRIPT = Path(__file__).with_name('katex_runtime') / 'validate.cjs'
MAX_BYTES = 1_048_576
TIMEOUT_SECONDS = 5
_SLOTS = WeakKeyDictionary()


class TexValidatorUnavailable(ServiceError):
    code = 'tex_validator_unavailable'
    status_code = 503

    def __init__(self):
        super().__init__('Проверка формул временно недоступна',
                         details={'reason_code': 'tex_validator_unavailable'})


def _texts(value, path='$'):
    if isinstance(value, str):
        yield {'path': path, 'text': value}
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from _texts(child, f'{path}[{i}]')
    elif isinstance(value, dict):
        for key, child in value.items():
            # Only bounded schema keys reach this helper after the stage validator.
            if isinstance(key, str) and key.isidentifier():
                if key == 'figure' and isinstance(child, dict) and child.get('kind') in ('number_line', 'unit_circle'):
                    if isinstance(child.get('variable'), str):
                        yield {'path': f'{path}.figure.variable', 'text': child['variable'], 'math': True}
                    for i, point in enumerate(child.get('points', [])):
                        if isinstance(point, dict) and isinstance(point.get('value'), str):
                            yield {'path': f'{path}.figure.points[{i}].value', 'text': point['value'], 'math': True}
                yield from _texts(child, f'{path}.{key}')


async def tex_errors(value, path='$'):
    loop = asyncio.get_running_loop()
    slots = _SLOTS.setdefault(loop, asyncio.Semaphore(1))
    async with slots:
        return await _validate(value, path)


async def _validate(value, path='$'):
    """One subprocess per stage attempt, no model calls or network, no raw error echo."""
    batch = list(_texts(value, path))
    if not batch:
        return []
    payload = json.dumps(batch, ensure_ascii=False).encode('utf-8')
    if len(batch) > 4096 or len(payload) > MAX_BYTES:
        return [f'{path}: invalid_tex: formula validation input exceeds its bounded size']
    node = shutil.which('node')
    if node is None:
        raise TexValidatorUnavailable()
    process = None
    try:
        spawning = asyncio.create_task(asyncio.create_subprocess_exec(
            node, '--max-old-space-size=64', '--stack-size=512', str(SCRIPT),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env={'NODE_ENV': 'production'}))
        try:
            process = await asyncio.shield(spawning)
        except asyncio.CancelledError:
            process = await spawning
            raise
        output, _ = await asyncio.wait_for(process.communicate(payload), TIMEOUT_SECONDS)
        if process.returncode != 0 or len(output) > 32_768:
            raise TexValidatorUnavailable()
        data = json.loads(output)
        allowed = {entry['path'] for entry in batch}
        if (set(data) != {'version', 'issues'} or data['version'] != '0.16.22'
                or not isinstance(data['issues'], list) or len(data['issues']) > 30
                or any(not isinstance(item, str) or item not in allowed for item in data['issues'])):
            raise TexValidatorUnavailable()
        return [f'{item}: invalid_tex: formula cannot be rendered by KaTeX; preserve its mathematics and correct only TeX syntax'
                for item in data['issues']]
    except (OSError, TimeoutError, ValueError, TypeError):
        raise TexValidatorUnavailable() from None
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
