"""Describe locally installed task packages without invoking a provider."""
from pathlib import Path

from app.core.errors import ValidationError
from app.grading.package import MAX_SCORES, ROOT, load_package, package_paths
from app.grading.validator import load_error_codes


class TaskPackageError(ValidationError):
    code = 'task_package_unavailable'


def task_descriptor(task_number: int, *, root: Path = ROOT) -> dict:
    paths = package_paths(task_number, root=root)
    missing = [str(path.relative_to(root)) for path in paths.values() if not path.is_file()]
    message = ''
    if missing:
        message = f'Для задания №{task_number} добавь файлы: ' + ', '.join(missing)
    else:
        try:
            package = load_package(task_number, root=root)
            if any(not text.strip() for text in package.values()):
                message = f'В пакете задания №{task_number} есть пустые промпты'
            else:
                load_error_codes(paths['popular_mistakes.md'])
        except (OSError, UnicodeError, ValueError):
            message = (f'Не удалось прочитать пакет задания №{task_number}. '
                       'Проверь файлы UTF-8 и таблицу E-кодов в popular_mistakes.md')
    return {'task_number': task_number, 'max_score': MAX_SCORES[task_number],
            'available': not message, 'message': message, 'missing_files': missing}


def task_choices(*, root: Path = ROOT) -> list[dict]:
    return [task_descriptor(number, root=root) for number in MAX_SCORES]


def require_task(task_number: int, *, root: Path = ROOT) -> dict:
    if type(task_number) is not int or task_number not in MAX_SCORES:
        raise ValidationError('Выбери номер задания от 14 до 20')
    descriptor = task_descriptor(task_number, root=root)
    if not descriptor['available']:
        raise TaskPackageError(descriptor['message'])
    return descriptor
