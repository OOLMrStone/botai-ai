"""Strict service-to-service data, separate from the approved model response."""
from dataclasses import dataclass
from uuid import UUID

from app.core.errors import ServiceError
from app.grading.validator import parse_response

CONTRACT_VERSION = 'photo-grade.v1'
INTERNAL_PATH = '/internal/v1/grading'
MAX_BODY_BYTES = 33 * 1024 * 1024
MAX_METADATA_BYTES = 512 * 1024
MAX_SOLUTION_IMAGES = 4


class InternalGradingError(ServiceError):
    def __init__(self, code: str, message: str, status_code: int = 422):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def canonical_uuid(value: object) -> bool:
    if type(value) is not str or len(value) != 36:
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


@dataclass(frozen=True)
class PreparedRequest:
    task_version_id: str
    task: dict
    solution_image_ids: list[str]


def parse_metadata(raw: str) -> PreparedRequest:
    """Reject ambiguous JSON before it can become model input or correlation."""
    invalid = InternalGradingError('invalid_task_snapshot', 'Некорректные данные задачи или фотографий')
    if type(raw) is not str:
        raise invalid
    try:
        if len(raw.encode('utf-8')) > MAX_METADATA_BYTES:
            raise invalid
        value = parse_response(raw)
    except (ValueError, RecursionError, UnicodeError):
        raise invalid from None
    if type(value) is not dict or set(value) != {
            'contract_version', 'task_version_id', 'task', 'solution_image_ids'}:
        raise invalid
    if value['contract_version'] != CONTRACT_VERSION:
        raise InternalGradingError('unsupported_contract', 'Версия контракта проверки не поддерживается')
    task = value['task']
    if not canonical_uuid(value['task_version_id']) or type(task) is not dict or set(task) != {
            'id', 'task_number', 'max_score', 'statement', 'reference_answer', 'reference_solution'}:
        raise invalid
    if (not canonical_uuid(task['id']) or type(task['task_number']) is not int
            or type(task['max_score']) is not int):
        raise invalid
    for name, limit in (('statement', 16000), ('reference_answer', 16000), ('reference_solution', 32000)):
        text = task[name]
        if name == 'reference_solution' and text is None:
            continue
        if type(text) is not str or not text.strip() or len(text) > limit:
            raise invalid
        try:
            text.encode('utf-8')
        except UnicodeError:
            raise invalid from None
    ids = value['solution_image_ids']
    if (type(ids) is not list or not 1 <= len(ids) <= MAX_SOLUTION_IMAGES
            or not all(canonical_uuid(item) for item in ids) or len(set(ids)) != len(ids)):
        raise invalid
    return PreparedRequest(value['task_version_id'], task, ids)
