"""Explicit approved handlers; an empty task directory never enables grading."""
from collections.abc import Callable
from dataclasses import dataclass
import hashlib
from pathlib import Path

from app.grading.internal_contract import CONTRACT_VERSION, InternalGradingError
from app.grading.package import load_package, task_directory
from app.grading.service import GradingService
from app.grading.validator import ValidationGate, load_error_codes

# FIPI draft 2027 specification, section 10; independent of legacy rubrics.
MAX_SCORES = {14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4}


def package_digest(package: dict[str, str]) -> str:
    digest = hashlib.sha256()
    for name, content in sorted(package.items()):
        encoded = content.encode('utf-8')
        digest.update(name.encode('utf-8') + b'\0')
        digest.update(str(len(encoded)).encode('ascii') + b'\0' + encoded)
    return 'sha256:' + digest.hexdigest()


@dataclass(frozen=True)
class Capability:
    task_number: int
    max_score: int
    package_id: str | None = None
    package: dict[str, str] | None = None
    handler_factory: Callable | None = None
    validator_factory: Callable | None = None
    catalog_path: Path | None = None

    @property
    def supported(self) -> bool:
        return (self.package is not None and self.handler_factory is not None
                and self.validator_factory is not None)

    def descriptor(self) -> dict:
        return {'task_number': self.task_number, 'max_score': self.max_score,
                'package_id': self.package_id, 'package_available': self.package is not None,
                'supported': self.supported, 'response_contract': CONTRACT_VERSION}

    def check_unchanged(self):
        # The existing validator reads its trusted catalog from disk. Refuse a
        # deployment edited during a run instead of claiming the old digest.
        try:
            unchanged = not self.supported or package_digest(load_package(self.task_number)) == self.package_id
        except (OSError, UnicodeError):
            unchanged = False
        if not unchanged:
            raise InternalGradingError('grading_package_changed',
                                       'Пакет проверки изменился. Попробуй позже', 503)


def build_registry() -> dict[int, Capability]:
    package = load_package(16)
    catalog = task_directory(16) / 'popular_mistakes.md'
    load_error_codes(catalog)
    registry = {number: Capability(number, maximum) for number, maximum in MAX_SCORES.items()}
    registry[16] = Capability(16, MAX_SCORES[16], package_digest(package), package,
                              GradingService, ValidationGate, catalog)
    return registry


def select_capability(registry: dict[int, Capability], task: dict) -> Capability:
    capability = registry.get(task['task_number'])
    if capability is None or capability.max_score != task['max_score']:
        raise InternalGradingError('invalid_task_snapshot', 'Номер задания или максимальный балл не совпадают')
    if not capability.supported:
        raise InternalGradingError('unsupported_task', 'Проверка этого задания пока недоступна')
    return capability
