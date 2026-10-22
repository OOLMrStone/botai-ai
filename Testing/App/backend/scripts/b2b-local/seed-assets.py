#!/usr/bin/env python3
"""Operator container: normalize/upload trusted task assets; no AI application import/call."""
import datetime
import hashlib
import hmac
import io
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
import warnings
from pathlib import Path
from PIL import Image, ImageOps

NAMESPACE = uuid.UUID('65b74f60-b245-49e4-9321-bd629d15b731')
ROOT = Path('/fixtures')
ENDPOINT = 'http://garage:3900'
Image.MAX_IMAGE_PIXELS = 20_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def storage(method, key, body=b''):
    path = '/botai/' + key
    now = datetime.datetime.now(datetime.timezone.utc)
    date, stamp = now.strftime('%Y%m%d'), now.strftime('%Y%m%dT%H%M%SZ')
    digest = hashlib.sha256(body).hexdigest()
    headers = {'host': 'garage:3900', 'x-amz-content-sha256': digest, 'x-amz-date': stamp}
    signed = 'host;x-amz-content-sha256;x-amz-date'
    canonical = (f'{method}\n{path}\n\n' + ''.join(f'{name}:{headers[name]}\n' for name in signed.split(';'))
                 + '\n' + signed + '\n' + digest)
    scope = f'{date}/garage/s3/aws4_request'
    value = f'AWS4-HMAC-SHA256\n{stamp}\n{scope}\n' + hashlib.sha256(canonical.encode()).hexdigest()
    derived = ('AWS4' + os.environ['S3_SECRET_KEY']).encode()
    for part in (date, 'garage', 's3', 'aws4_request'):
        derived = hmac.new(derived, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(derived, value.encode(), hashlib.sha256).hexdigest()
    headers['Authorization'] = (f'AWS4-HMAC-SHA256 Credential={os.environ["S3_ACCESS_KEY"]}/{scope}, '
                                f'SignedHeaders={signed}, Signature={signature}')
    if method == 'PUT':
        headers['Content-Type'] = 'image/jpeg'
    request = urllib.request.Request(ENDPOINT + path, data=body if method == 'PUT' else None,
                                     headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, response.read(8 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as error:
        return error.code, b''


def main():
    package = json.loads((ROOT / 'package.json').read_text())
    if package.get('schemaVersion') != 1 or not 1 <= len(package.get('cases', [])) <= 1000:
        raise ValueError('Unsupported private fixture package')
    receipt = []
    for case in package['cases']:
        task_id = uuid.uuid5(NAMESPACE, 'task:' + case['id'])
        sources = [('statement', case['files']['statement']), ('reference', case['files']['taskReference'])]
        solutions = case['files']['studentSolution']
        solutions = solutions if isinstance(solutions, list) else [solutions]
        sources += [(f'solution-{i}', asset) for i, asset in enumerate(solutions)]
        for kind, asset in sources:
            path = ROOT / asset['path']
            if path.is_symlink() or ROOT not in path.resolve().parents:
                raise ValueError('Unsafe task asset path')
            raw = path.read_bytes()
            if len(raw) > 8 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != asset['sha256']:
                raise ValueError('Task asset integrity failure')
            with Image.open(io.BytesIO(raw)) as image:
                if (image.format not in ('PNG', 'JPEG') or getattr(image, 'n_frames', 1) != 1
                        or max(image.size) > 8192 or image.width * image.height > 20_000_000):
                    raise ValueError('Unsupported task image geometry/format')
                image = ImageOps.exif_transpose(image)
                rgba = image.convert('RGBA')
                clean = Image.new('RGB', rgba.size, 'white')
                clean.paste(rgba, mask=rgba.getchannel('A'))
                stream = io.BytesIO()
                clean.save(stream, format='JPEG', quality=75)
                payload = stream.getvalue()
            if not 0 < len(payload) <= 8 * 1024 * 1024:
                raise ValueError('Normalized task asset exceeds upload budget')
            digest = hashlib.sha256(payload).hexdigest()
            asset_id = uuid.uuid5(NAMESPACE, 'asset:' + case['id'] + ':' + kind)
            key = f'b2b-seed/{asset_id}/{digest}.jpg'
            status, previous = storage('GET', key)
            if status == 404:
                if storage('PUT', key, payload)[0] != 200:
                    raise RuntimeError('Private task asset upload failed')
            elif status != 200 or previous != payload:
                raise RuntimeError('Existing task asset differs; preserved without replacement')
            status, checked = storage('GET', key)
            if status != 200 or checked != payload:
                raise RuntimeError('Private task asset readback failed')
            receipt.append({'caseId': case['id'], 'taskId': str(task_id), 'id': str(asset_id), 'kind': kind,
                            'bucket': 'botai', 'objectKey': key, 'fileName': kind + '.jpg',
                            'mimeType': 'image/jpeg', 'sizeBytes': len(payload), 'sha256': digest})
    # Parent captures this receipt privately; no key/token/provider/model payload appears here.
    print(json.dumps({'assets': receipt}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Private asset preparation failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
