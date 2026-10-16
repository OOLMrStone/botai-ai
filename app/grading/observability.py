"""Bounded, private in-memory evidence for local v2 runs; never provider transcripts."""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import math
import re
from threading import RLock
import time
from uuid import uuid4

from PIL import Image

from app.core.errors import ServiceError
from app.grading.images import MAX_PIXELS
from app.grading.internal_contract import InternalGradingError, canonical_uuid

TTL_SECONDS = 30 * 60
MAX_RUNS = 32
MAX_STORE_BYTES = 128 * 1024 * 1024
MAX_ARTIFACT_BYTES = 1024 * 1024
MAX_DIAGRAMS = 8
MAX_JSON_ARTIFACTS = 8
MAX_EVENTS = 512
PHASES = {'input', 'preparation', 'ocr', 'diagrams', 'layout', 'analysis', 'grading', 'validation'}
EVENT_TYPES = {'run_started', 'stage_started', 'stage_completed', 'stage_failed', 'validation_failed',
               'retry', 'artifact_ready', 'completed', 'failed', 'cancelled',
               'model_started', 'model_completed', 'model_failed'}
JSON_KINDS = {'ocr', 'analysis', 'grading', 'final'}
UNSAFE_KEYS = {'messages', 'prompt', 'prompts', 'system_prompt', 'reasoning_content', 'reasoning',
               'api_key', 'authorization', 'headers', 'request_headers', 'provider_response',
               'raw_response', 'raw', 'raw_prompt', 'secret', 'token'}
SAFE_CODE = re.compile(r'^[a-z][a-z0-9_]{0,63}$')
SAFE_PATH = re.compile(r'^\$(?:\.[a-z_][a-z0-9_]*|\[\d{1,5}\]){0,20}$')


def _failure(code, message, status=422):
    return InternalGradingError(code, message, status)


def _safe_data(data):
    """Project trusted diagnostics onto a small schema; never persist arbitrary messages."""
    if data is None:
        return {}
    if type(data) is not dict:
        raise ValueError('Event data must be an object')
    safe = {}
    for key in ('attempt', 'task_number', 'image_count'):
        value = data.get(key)
        if type(value) is int and 0 <= value <= 10000:
            safe[key] = value
    value = data.get('duration_ms')
    if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 3_600_000:
        safe['duration_ms'] = round(value, 3)
    for key in ('valid', 'is_graded'):
        if type(data.get(key)) is bool:
            safe[key] = data[key]
    for key in ('code', 'error_code'):
        value = data.get(key)
        if type(value) is str and SAFE_CODE.fullmatch(value):
            safe[key] = value
    for key in ('artifact_id', 'call_id'):
        if canonical_uuid(data.get(key)):
            safe[key] = data[key]
    if data.get('operation') in ('chat', 'transcribe'):
        safe['operation'] = data['operation']
    for key, predicate in (('artifact_ids', canonical_uuid),
                           ('issue_codes', lambda v: type(v) is str and bool(SAFE_CODE.fullmatch(v))),
                           ('issue_paths', lambda v: type(v) is str and bool(SAFE_PATH.fullmatch(v)))):
        values = data.get(key)
        if type(values) is list:
            safe[key] = [value for value in values[:40] if predicate(value)]
    return safe


def _safe_document(kind, document):
    if kind not in JSON_KINDS or type(document) is not dict:
        raise ValueError('Expected a validated stage document')
    expected = {
        'ocr': {'steps', 'answer'},
        'analysis': {'summary', 'checks', 'student_answer', 'errors', 'strengths', 'statuses'},
        'grading': {'score', 'criterion', 'explanation'},
        'final': {'task', 'solution_image_ids', 'is_graded', 'rejection_reason', 'ocr', 'analysis', 'grading', 'artifacts'},
    }
    if set(document) != expected[kind]:
        raise ValueError('Unexpected stage document fields')

    def check(value, depth=0):
        if depth > 30:
            raise ValueError('Stage document is too deep')
        if type(value) is dict:
            for key, item in value.items():
                if type(key) is not str or key.lower() in UNSAFE_KEYS:
                    raise ValueError('Unsafe artifact field')
                check(item, depth + 1)
        elif type(value) is list:
            for item in value:
                check(item, depth + 1)
        elif value is not None and type(value) not in (str, int, float, bool):
            raise ValueError('Artifact is not JSON data')
    check(document)
    return json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


@dataclass
class Artifact:
    data: bytes
    media_type: str
    metadata: dict


@dataclass
class RunRecord:
    run_id: str
    provider_mode: str
    package_id: str
    created: float
    events: list[dict] = field(default_factory=list)
    artifacts: dict[str, Artifact] = field(default_factory=dict)
    byte_size: int = 0
    terminal: bool = False


class RunStore:
    def __init__(self, *, clock=time.monotonic, ttl_seconds=TTL_SECONDS,
                 max_runs=MAX_RUNS, max_bytes=MAX_STORE_BYTES):
        self._clock = clock
        self.ttl_seconds, self.max_runs, self.max_bytes = ttl_seconds, max_runs, max_bytes
        self._runs = {}
        self._bytes = 0
        self._lock = RLock()

    def _cleanup(self):
        now = self._clock()
        for run_id, record in list(self._runs.items()):
            if now - record.created >= self.ttl_seconds:
                self._bytes -= record.byte_size
                del self._runs[run_id]

    def cleanup(self):
        with self._lock:
            self._cleanup()

    def _record(self, run_id):
        self._cleanup()
        record = self._runs.get(run_id)
        if record is None:
            raise _failure('run_not_found', 'Проверка не найдена или срок хранения истёк', 404)
        return record

    def start(self, run_id, *, provider_mode, package_id='none'):
        with self._lock:
            self._cleanup()
            if not canonical_uuid(run_id):
                raise _failure('invalid_request_id', 'Нужен UUID запуска проверки')
            if run_id in self._runs:
                raise _failure('duplicate_run', 'Этот UUID проверки уже использован', 409)
            if len(self._runs) >= self.max_runs:
                raise _failure('run_store_full', 'Хранилище проверок заполнено. Попробуй позже', 503)
            self._runs[run_id] = RunRecord(run_id, provider_mode, package_id, self._clock())
            trace = Trace(self, run_id)
            trace.emit('run_started', 'input')
            return trace

    def set_package(self, run_id, package_id):
        with self._lock:
            self._record(run_id).package_id = package_id

    def provenance(self, run_id):
        with self._lock:
            record = self._record(run_id)
            return record.provider_mode, record.package_id

    def _reserve(self, record, size):
        if self._bytes + size > self.max_bytes:
            raise _failure('run_store_full', 'Хранилище проверок заполнено. Попробуй позже', 503)
        record.byte_size += size
        self._bytes += size

    def emit(self, run_id, kind, phase, data=None):
        if kind not in EVENT_TYPES or phase not in PHASES:
            raise ValueError('Unknown event type or phase')
        safe = _safe_data(data)
        with self._lock:
            record = self._record(run_id)
            if record.terminal:
                return
            if len(record.events) >= MAX_EVENTS:
                raise _failure('trace_limit_exceeded', 'Проверка превысила лимит событий', 503)
            event = {'seq': len(record.events) + 1, 'run_id': run_id, 'type': kind, 'phase': phase,
                     'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'data': safe}
            self._reserve(record, len(json.dumps(event).encode('utf-8')))
            record.events.append(event)
            if kind in ('completed', 'failed', 'cancelled'):
                record.terminal = True

    def events(self, run_id, *, after=0, limit=100):
        if type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 100:
            raise _failure('invalid_cursor', 'Некорректный курсор событий')
        with self._lock:
            record = self._record(run_id)
            items = [event for event in record.events if event['seq'] > after][:limit]
            cursor = items[-1]['seq'] if items else after
            return {'items': deepcopy(items), 'next_after': cursor,
                    'has_more': any(event['seq'] > cursor for event in record.events)}

    def add_artifact(self, run_id, artifact_id, artifact):
        if len(artifact.data) > MAX_ARTIFACT_BYTES:
            raise _failure('artifact_too_large', 'Артефакт проверки превышает 1 МиБ', 503)
        with self._lock:
            record = self._record(run_id)
            if record.terminal or artifact_id in record.artifacts:
                raise _failure('invalid_artifact', 'Артефакт нельзя сохранить', 503)
            diagram = artifact.metadata.get('kind') == 'diagram'
            count = sum((entry.metadata.get('kind') == 'diagram') == diagram for entry in record.artifacts.values())
            if count >= (MAX_DIAGRAMS if diagram else MAX_JSON_ARTIFACTS):
                raise _failure('artifact_limit_exceeded', 'Превышен лимит артефактов проверки', 503)
            size = len(artifact.data) + len(json.dumps(artifact.metadata).encode('utf-8'))
            self._reserve(record, size)
            record.artifacts[artifact_id] = artifact

    def artifact(self, run_id, artifact_id):
        with self._lock:
            artifact = self._record(run_id).artifacts.get(artifact_id)
            if artifact is None:
                raise _failure('artifact_not_found', 'Артефакт не найден', 404)
            return Artifact(artifact.data, artifact.media_type, deepcopy(artifact.metadata))

    def image_artifacts(self, run_id):
        with self._lock:
            return [deepcopy(item.metadata) for item in self._record(run_id).artifacts.values()
                    if item.metadata.get('kind') == 'diagram']


class Trace:
    def __init__(self, store, run_id):
        self.store, self.run_id = store, run_id
        self.reader_ocr = None
        self.task_snapshot = None
        self.solution_image_ids = []

    def emit(self, kind, phase, data=None):
        self.store.emit(self.run_id, kind, phase, data)

    @property
    def image_artifacts(self):
        return self.store.image_artifacts(self.run_id)

    @property
    def diagram_metadata(self):
        return self.image_artifacts

    def add_json(self, kind, document):
        payload = _safe_document(kind, document)
        artifact_id = str(uuid4())
        self.store.add_artifact(self.run_id, artifact_id, Artifact(payload, 'application/json',
                                                                 {'id': artifact_id, 'kind': kind}))
        self.emit('artifact_ready', 'validation', {'artifact_id': artifact_id})
        return artifact_id

    def add_image(self, metadata, data):
        required = {'id', 'kind', 'source_image_id', 'bbox', 'media_type', 'byte_size', 'width', 'height', 'sha256'}
        if type(metadata) is not dict or set(metadata) != required or type(data) is not bytes:
            raise ValueError('Invalid diagram artifact')
        if (not canonical_uuid(metadata['id']) or not canonical_uuid(metadata['source_image_id'])
                or metadata['source_image_id'] not in self.solution_image_ids
                or metadata['kind'] != 'diagram' or metadata['media_type'] != 'image/jpeg'
                or type(metadata['byte_size']) is not int or metadata['byte_size'] != len(data)
                or len(data) > MAX_ARTIFACT_BYTES or not data
                or metadata['sha256'] != hashlib.sha256(data).hexdigest()):
            raise ValueError('Invalid diagram artifact metadata')
        bbox = metadata['bbox']
        if type(bbox) is not dict or set(bbox) != {'x', 'y', 'width', 'height'}:
            raise ValueError('Invalid diagram bounds')
        if any(type(value) not in (int, float) or not math.isfinite(value) for value in bbox.values()):
            raise ValueError('Invalid diagram bounds')
        if (not 0 <= bbox['x'] < 1 or not 0 <= bbox['y'] < 1 or not 0 < bbox['width'] <= 1
                or not 0 < bbox['height'] <= 1 or bbox['x'] + bbox['width'] > 1 or bbox['y'] + bbox['height'] > 1):
            raise ValueError('Invalid diagram bounds')
        if any(type(metadata[key]) is not int or not 1 <= metadata[key] <= 8192 for key in ('width', 'height')):
            raise ValueError('Invalid diagram dimensions')
        if metadata['width'] * metadata['height'] > MAX_PIXELS:
            raise ValueError('Diagram exceeds the pixel limit')
        with Image.open(BytesIO(data)) as image:
            if image.format != 'JPEG' or image.size != (metadata['width'], metadata['height']):
                raise ValueError('Diagram pixels do not match metadata')
            image.verify()
        self.store.add_artifact(self.run_id, metadata['id'], Artifact(data, 'image/jpeg', deepcopy(metadata)))
        self.emit('artifact_ready', 'diagrams', {'artifact_id': metadata['id']})

    @contextmanager
    def stage(self, phase):
        self.emit('stage_started', phase)
        started = time.monotonic()
        try:
            yield
        except BaseException as exc:
            code = exc.code if isinstance(exc, ServiceError) else 'stage_failed'
            self.emit('stage_failed', phase, {'duration_ms': (time.monotonic() - started) * 1000, 'code': code})
            raise
        else:
            self.emit('stage_completed', phase, {'duration_ms': (time.monotonic() - started) * 1000})
