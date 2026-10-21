"""Private diagram crops and the exact, trusted photo-grade.v2 response boundary."""
from copy import deepcopy
import hashlib
from io import BytesIO
import math
import re
from uuid import UUID, uuid4

from PIL import Image, UnidentifiedImageError

from app.core.errors import ValidationError
from app.grading.images import MAX_PIXELS, SafeImage
from app.grading.validator import SCHEMA, parse_response, validate_response


MAX_DIAGRAM_BYTES = 1024 * 1024
MAX_DIAGRAM_SIDE = 8192
BBOX_FIELDS = ('x', 'y', 'width', 'height')
ARTIFACT_FIELDS = ('id', 'kind', 'source_image_id', 'bbox', 'media_type',
                   'byte_size', 'width', 'height', 'sha256')


def _uuid(value):
    if type(value) is not str:
        return False
    try:
        return str(UUID(value)) == value
    except (ValueError, AttributeError):
        return False


def _fields(value, required, path):
    return ([f'{path}.{key}: missing required field' for key in required if key not in value]
            + [f'{path}.{key}: unexpected field' for key in value if key not in required])


def _bbox_errors(bbox, path):
    if type(bbox) is not dict:
        return [f'{path}: expected an object']
    errors = _fields(bbox, BBOX_FIELDS, path)
    valid = True
    for key in BBOX_FIELDS:
        value = bbox.get(key)
        if (type(value) not in (int, float) or not 0 <= value <= 1
                or (type(value) is float and not math.isfinite(value))):
            errors.append(f'{path}.{key}: expected a finite coordinate from 0 to 1')
            valid = False
    if valid:
        if bbox['width'] <= 0 or bbox['height'] <= 0:
            errors.append(f'{path}: width and height must be positive')
        if bbox['x'] + bbox['width'] > 1 or bbox['y'] + bbox['height'] > 1:
            errors.append(f'{path}: crop extends beyond the source image')
    return errors


def crop_diagram(image: SafeImage, source_image_id: str, bbox: dict, *,
                 artifact_id: str | None = None) -> tuple[dict, bytes]:
    """Crop already-normalized source pixels; the caller must authorize the source ID."""
    if not _uuid(source_image_id) or (artifact_id is not None and not _uuid(artifact_id)):
        raise ValidationError('Некорректный идентификатор изображения или чертежа')
    if _bbox_errors(bbox, '$.bbox'):
        raise ValidationError('Некорректные границы чертежа')
    if not isinstance(image, SafeImage) or type(image.data) is not bytes:
        raise ValidationError('Не удалось открыть исходное изображение чертежа')
    try:
        with Image.open(BytesIO(image.data)) as source:
            if (source.width * source.height > MAX_PIXELS
                    or max(source.size) > MAX_DIAGRAM_SIDE or getattr(source, 'n_frames', 1) != 1):
                raise ValidationError('Исходное изображение чертежа слишком большое или не статичное')
            source.load()
            # Outward rounding retains every source pixel touched by the normalized box.
            left, top = math.floor(bbox['x'] * source.width), math.floor(bbox['y'] * source.height)
            right = math.ceil((bbox['x'] + bbox['width']) * source.width)
            bottom = math.ceil((bbox['y'] + bbox['height']) * source.height)
            if not (0 <= left < right <= source.width and 0 <= top < bottom <= source.height):
                raise ValidationError('Границы чертежа не содержат пикселей изображения')
            crop = source.crop((left, top, right, bottom)).convert('RGB')
            output = BytesIO()
            crop.save(output, format='JPEG', quality=95)
            payload = output.getvalue()
            if not payload or len(payload) > MAX_DIAGRAM_BYTES:
                raise ValidationError('Изображение чертежа должно быть не больше 1 МБ')
            metadata = {'id': artifact_id or str(uuid4()), 'kind': 'diagram',
                        'source_image_id': source_image_id, 'bbox': dict(bbox),
                        'media_type': 'image/jpeg', 'byte_size': len(payload),
                        'width': crop.width, 'height': crop.height,
                        'sha256': hashlib.sha256(payload).hexdigest()}
            return metadata, payload
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ValidationError('Не удалось получить изображение чертежа') from exc


def _same(left, right):
    """JSON identity without Python's bool/int equality or any mutation of trusted data."""
    if type(left) is not type(right):
        return False
    if type(left) is dict:
        return left.keys() == right.keys() and all(_same(left[k], right[k]) for k in left)
    if type(left) is list:
        return len(left) == len(right) and all(_same(a, b) for a, b in zip(left, right))
    return left == right


def project_native_figure_for_validation(figure, path):
    """Validate v2 limits/path, then project a copy for the unchanged v1 validator."""
    projection = deepcopy(figure)
    errors = []
    if type(figure) is not dict or figure.get('kind') not in ('number_line', 'unit_circle'):
        return errors, projection
    for key, limit in (('points', 64), ('arcs', 128)):
        if type(figure.get(key)) is list and len(figure[key]) > limit:
            errors.append(f'{path}.{key}: at most {limit} entries')
    if type(figure.get('points')) is list:
        for index, point in enumerate(figure['points']):
            if type(point) is not dict:
                continue
            for key, limit in (('id', 128), ('value', 500)):
                if type(point.get(key)) is str and len(point[key]) > limit:
                    errors.append(f'{path}.points[{index}].{key}: at most {limit} characters')
    if figure['kind'] == 'number_line':
        for key, limit in (('variable', 64), ('note', 2000)):
            if type(figure.get(key)) is str and len(figure[key]) > limit:
                errors.append(f'{path}.{key}: at most {limit} characters')
        return errors, projection
    arcs = figure.get('arcs')
    if type(arcs) is not list:
        return errors, projection  # The shared validator handles the remaining shape.
    for index, arc in enumerate(arcs):
        if type(arc) is not dict:
            continue
        where = f'{path}.arcs[{index}]'
        if arc.get('direction') not in ('cw', 'ccw'):
            errors.append(f'{where}.direction: required cw or ccw; no default is inferred')
        full_circle = arc.get('full_circle')
        if type(full_circle) is not bool:
            errors.append(f'{where}.full_circle: required boolean')
        elif (type(arc.get('from')) is str and type(arc.get('to')) is str
              and full_circle != (arc['from'] == arc['to'])):
            errors.append(f'{where}.full_circle: must be true exactly when endpoint IDs are equal')
        projection['arcs'][index].pop('direction', None)
        projection['arcs'][index].pop('full_circle', None)
    return errors, projection


def _artifact_errors(artifacts, image_ids):
    if type(artifacts) is not list:
        return ['$.artifacts: expected a list']
    errors, seen = [], set()
    for index, artifact in enumerate(artifacts):
        path = f'$.artifacts[{index}]'
        if type(artifact) is not dict:
            errors.append(f'{path}: expected an object')
            continue
        errors += _fields(artifact, ARTIFACT_FIELDS, path)
        identifier = artifact.get('id')
        if not _uuid(identifier):
            errors.append(f'{path}.id: expected a canonical UUID')
        elif identifier in seen:
            errors.append(f'{path}.id: duplicate artifact ID')
        else:
            seen.add(identifier)
        source = artifact.get('source_image_id')
        if not _uuid(source) or source not in image_ids:
            errors.append(f'{path}.source_image_id: expected a student image ID from this run')
        if artifact.get('kind') != 'diagram':
            errors.append(f'{path}.kind: expected diagram')
        if artifact.get('media_type') != 'image/jpeg':
            errors.append(f'{path}.media_type: expected image/jpeg')
        errors += _bbox_errors(artifact.get('bbox'), path + '.bbox')
        size = artifact.get('byte_size')
        if type(size) is not int or not 1 <= size <= MAX_DIAGRAM_BYTES:
            errors.append(f'{path}.byte_size: expected 1 to {MAX_DIAGRAM_BYTES} bytes')
        width, height = artifact.get('width'), artifact.get('height')
        if any(type(v) is not int or not 1 <= v <= MAX_DIAGRAM_SIDE for v in (width, height)):
            errors.append(f'{path}: expected positive image dimensions up to {MAX_DIAGRAM_SIDE}')
        elif width * height > MAX_PIXELS:
            errors.append(f'{path}: image exceeds the pixel limit')
        digest = artifact.get('sha256')
        if type(digest) is not str or re.fullmatch('[0-9a-f]{64}', digest) is None:
            errors.append(f'{path}.sha256: expected 64 lowercase hexadecimal characters')
    return errors


def _causal_errors(statuses, steps):
    errors = []
    if type(statuses) is not list or type(steps) is not list:
        return errors  # The shared validator reports the structural error.
    positions = {step['id']: index for index, step in enumerate(steps)
                 if type(step) is dict and type(step.get('id')) is str}
    by_id = {status['id']: status for status in statuses
             if type(status) is dict and type(status.get('id')) is str}
    for index, status in enumerate(statuses):
        if type(status) is not dict:
            continue
        path = f'$.analysis.statuses[{index}].follows_from_step_ids'
        links = status.get('follows_from_step_ids')
        if type(links) is not list:
            errors.append(f'{path}: required list of step IDs')
            continue
        if status.get('status') != 'consequence':
            if links:
                errors.append(f'{path}: must be empty except for consequence steps')
            continue
        if not links:
            errors.append(f'{path}: consequence requires at least one earlier error step')
        seen = set()
        current = positions.get(status.get('id')) if type(status.get('id')) is str else None
        for link in links:
            if type(link) is not str:
                errors.append(f'{path}: expected string step IDs')
                continue
            if link in seen:
                errors.append(f'{path}: duplicate step ID')
            seen.add(link)
            previous = positions.get(link)
            if (current is None or previous is None or previous >= current
                    or by_id.get(link, {}).get('status') != 'error'):
                errors.append(f'{path}: {link!r} must name an earlier error step')
    return errors


def validate_v2_response(raw: str, *, task: dict, image_ids: list[str],
                         artifacts: list[dict], reader_ocr: dict) -> list[str]:
    """Validate the exact final JSON against this run; never rewrite the returned document."""
    try:
        response = parse_response(raw)
        raw.encode('utf-8')
    except (ValueError, RecursionError) as exc:
        return [str(exc)]
    if type(response) is not dict:
        return ['$: expected an object']
    errors = _fields(response, (*SCHEMA, 'artifacts'), '$')
    if not _same(response.get('task'), task):
        errors.append('$.task: differs from the trusted task snapshot')
    if not _same(response.get('solution_image_ids'), image_ids):
        errors.append('$.solution_image_ids: differs from the ordered source image IDs')
    if not _same(response.get('artifacts'), artifacts):
        errors.append('$.artifacts: differs from this run\'s trusted artifacts')
    declared = response.get('artifacts')
    errors += _artifact_errors(declared, image_ids)
    projection = deepcopy(response)
    projection.pop('artifacts', None)
    if response.get('is_graded') is False:
        if declared != []:
            errors.append('$.artifacts: must be empty for rejection')
        return errors + validate_response(projection)
    ocr = response.get('ocr')
    if type(ocr) is not dict:
        errors.append('$.ocr: graded v2 requires a structured OCR object')
    if not _same(ocr, reader_ocr):
        errors.append('$.ocr: differs from the unchanged reader snapshot')
    steps = ocr.get('steps') if type(ocr) is dict else None
    analysis = response.get('analysis')
    statuses = analysis.get('statuses') if type(analysis) is dict else None
    errors += _causal_errors(statuses, steps)
    if type(statuses) is list:
        for status in projection['analysis']['statuses']:
            if type(status) is dict:
                status.pop('follows_from_step_ids', None)
    artifact_ids = {a['id'] for a in declared if type(a) is dict and type(a.get('id')) is str} \
        if type(declared) is list else set()
    used = set()
    if type(steps) is list:
        for index, step in enumerate(steps):
            if type(step) is not dict:
                continue
            path = f'$.ocr.steps[{index}]'
            lines = step.get('lines')
            if (type(lines) is not list or len(lines) > 64
                    or any(type(line) is not str or len(line) > 16000 for line in lines)):
                errors.append(f'{path}.lines: expected at most 64 text lines of up to 16000 characters')
            if type(step.get('title')) is str and len(step['title']) > 500:
                errors.append(f'{path}.title: expected at most 500 characters')
            if step.get('figure') is None:
                continue
            figure = step.get('figure')
            path = f'$.ocr.steps[{index}].figure'
            if type(figure) is dict and figure.get('kind') == 'image':
                errors += _fields(figure, ('kind', 'artifact_id', 'alt'), path)
                identifier = figure.get('artifact_id')
                if type(identifier) is not str or identifier not in artifact_ids:
                    errors.append(f'{path}.artifact_id: no diagram artifact from this run')
                else:
                    used.add(identifier)
                if type(figure.get('alt')) is not str or not figure['alt'].strip() or len(figure['alt']) > 200:
                    errors.append(f'{path}.alt: expected a non-empty string of up to 200 characters')
                # A typed figure-only placeholder lets the shared validator check every
                # remaining step member without rewriting lines, title, ID, or output.
                projection['ocr']['steps'][index]['figure'] = {'kind': 'unit_circle', 'points': [], 'arcs': []}
            elif type(task) is dict and task.get('task_number') not in (14, 16):
                errors.append(f'{path}: this task requires a cropped image figure')
            elif type(figure) is dict and figure.get('kind') in ('number_line', 'unit_circle'):
                figure_errors, projected_figure = project_native_figure_for_validation(figure, path)
                errors += figure_errors
                projection['ocr']['steps'][index]['figure'] = projected_figure
    errors += [f'$.artifacts: unreferenced diagram artifact {identifier!r}'
               for identifier in sorted(artifact_ids - used)]
    return errors + validate_response(projection)
