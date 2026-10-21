"""Local-only authenticated v2 transport and private evidence endpoints."""
import asyncio
from dataclasses import dataclass
import hmac
import json
import re
from uuid import uuid4

from fastapi import APIRouter, Request
from starlette.datastructures import Headers, UploadFile
from starlette.exceptions import HTTPException
from starlette.requests import ClientDisconnect
from starlette.responses import JSONResponse, Response

from app.core.errors import LLMResponseFormatError, ServiceError
from app.grading import expert_grading
from app.grading.capabilities import package_digest
from app.grading.images import MAX_IMAGE_BYTES, sanitize
from app.grading.internal_contract import (MAX_METADATA_BYTES, InternalGradingError, canonical_uuid,
                                           parse_metadata as parse_v1_metadata)
from app.grading.observability import MAX_ARTIFACT_BYTES, MAX_DIAGRAMS, TTL_SECONDS
from app.grading.retry import classify, safe_diagnostics
from app.grading.package import MAX_SCORES, load_package, task_directory
from app.grading.validator import load_error_codes, parse_response

CONTRACT_VERSION = 'photo-grade.v2'
INTERNAL_PATH = '/internal/v2/grading'
PREPARED_BODY_BYTES = 33 * 1024 * 1024
MANUAL_BODY_BYTES = 41 * 1024 * 1024
SUPPORTED_TASKS = frozenset({14, 16, 17, 18})
RUN_PATH = re.compile(re.escape(INTERNAL_PATH) + r'/runs/([^/]+)/(events|artifacts/([^/]+))$')
ACK_PATH = re.compile(re.escape(INTERNAL_PATH) + r'/runs/([^/]+)$')
router = APIRouter(prefix=INTERNAL_PATH, tags=['local internal grading v2'])


def package_descriptor(number):
    package_id, available = None, False
    try:
        package = load_package(number)
        if not all(type(text) is str and text.strip() for text in package.values()):
            raise ValueError('Empty package file')
        load_error_codes(task_directory(number) / 'popular_mistakes.md')
        package_id, available = package_digest(package), True
    except (OSError, UnicodeError, ValueError):
        pass
    return {'task_number': number, 'max_score': MAX_SCORES[number], 'package_id': package_id,
            'package_available': available, 'supported': available and number in SUPPORTED_TASKS,
            'response_contract': CONTRACT_VERSION}


def parse_metadata(raw, *, manual=False):
    invalid = InternalGradingError('invalid_task_snapshot', 'Некорректные данные задачи или фотографий')
    try:
        if type(raw) is not str or len(raw.encode('utf-8')) > MAX_METADATA_BYTES:
            raise invalid
        data = parse_response(raw)
    except (ValueError, RecursionError, UnicodeError):
        raise invalid from None
    if type(data) is not dict:
        raise invalid
    if data.get('contract_version') != CONTRACT_VERSION:
        raise InternalGradingError('unsupported_contract', 'Версия контракта проверки не поддерживается')
    if not manual:
        prepared = parse_v1_metadata(json.dumps({**data, 'contract_version': 'photo-grade.v1'}, ensure_ascii=False))
        return {'task_version_id': prepared.task_version_id, 'task': prepared.task,
                'solution_image_ids': prepared.solution_image_ids}
    if set(data) != {'contract_version', 'task_version_id', 'task_id', 'task_number', 'task_image_id', 'solution_image_ids'}:
        raise invalid
    if (not all(canonical_uuid(data[key]) for key in ('task_version_id', 'task_id', 'task_image_id'))
            or type(data['task_number']) is not int):
        raise invalid
    ids = data['solution_image_ids']
    if (type(ids) is not list or not 1 <= len(ids) <= 4 or not all(canonical_uuid(value) for value in ids)
            or len(set(ids)) != len(ids) or data['task_image_id'] in ids):
        raise invalid
    return data


@dataclass
class RunContext:
    run_id: str
    settings: object
    provider_mode: str
    package_id: str = 'none'
    trace: object = None
    body_error: object = None
    contract_version: str = CONTRACT_VERSION

    def headers(self):
        return {'X-Request-ID': self.run_id, 'Cache-Control': 'no-store',
                'X-Grading-Contract-Version': self.contract_version,
                'X-Grading-Provider-Mode': self.provider_mode, 'X-Grading-Package-Id': self.package_id}


def failure_details(run, error):
    phase = run.trace.active_phase if run.trace is not None else 'input'
    context = run.trace.step_context if run.trace is not None else {}
    return safe_diagnostics({**context, **classify(error, phase)})


def error_response(run, code, message, status, *, error=None):
    error = error or InternalGradingError(code, message, status)
    return JSONResponse({'error': {'code': code, 'message': message, 'details': failure_details(run, error)},
                         'request_id': run.run_id}, status_code=status, headers=run.headers())


def finish_failure(run, error, *, cancelled=False):
    if run.trace is not None:
        if isinstance(error, str):
            error = InternalGradingError(error, '', 500)
        try:
            run.trace.emit('cancelled' if cancelled else 'failed', run.trace.active_phase,
                           {'code': error.code, **({} if cancelled else failure_details(run, error))})
        except (ServiceError, ValueError):
            pass  # A full/expired evidence store must not replace the original failure.


class GradingV2Middleware:
    """No body is read until service authentication and bounded-dispatch checks pass."""
    def __init__(self, app, settings, store):
        self.app, self.settings, self.store = app, settings, store

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or not (path == INTERNAL_PATH or path.startswith(INTERNAL_PATH + '/')):
            return await self.app(scope, receive, send)
        settings = self.settings.model_copy(deep=True)
        headers = Headers(scope=scope)
        ids = headers.getlist('x-request-id')
        valid_id = len(ids) == 1 and canonical_uuid(ids[0])
        run = RunContext(ids[0] if valid_id else str(uuid4()), settings,
                         'mock' if settings.llm.provider == 'mock' else 'live')
        is_expert = path == INTERNAL_PATH + '/grade-analysis'
        if is_expert:
            run.contract_version = expert_grading.CONTRACT_VERSION
        authorization = headers.getlist('authorization')
        secret = settings.internal_grading.token.get_secret_value()
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0].encode(), ('Bearer ' + secret).encode()):
            response = error_response(run, 'service_unauthorized', 'Нет доступа к сервису проверки', 401)
            response.headers['WWW-Authenticate'] = 'Bearer'
            return await response(scope, receive, send)
        match = RUN_PATH.fullmatch(path)
        ack = ACK_PATH.fullmatch(path)
        if path in (INTERNAL_PATH, INTERNAL_PATH + '/from-images', INTERNAL_PATH + '/grade-analysis'):
            method = 'POST'
        elif path == INTERNAL_PATH + '/capabilities':
            method = 'GET'
        elif ack and canonical_uuid(ack[1]):
            method = 'DELETE'
            run.run_id = ack[1]
        elif match and canonical_uuid(match[1]) and (match[3] is None or canonical_uuid(match[3])):
            method = 'GET'
            run.run_id = match[1]
            try:
                run.provider_mode, run.package_id = self.store.provenance(run.run_id)
            except ServiceError as exc:
                return await error_response(run, exc.code, exc.message, exc.status_code)(scope, receive, send)
        else:
            return await error_response(run, 'not_found', 'Маршрут не найден', 404)(scope, receive, send)
        if scope['method'] != method:
            return await error_response(run, 'method_not_allowed', 'Метод не поддерживается', 405)(scope, receive, send)
        if method == 'POST' and not valid_id:
            return await error_response(run, 'invalid_request_id', 'Нужен UUID запуска проверки', 422)(scope, receive, send)
        if method == 'POST' and run.provider_mode == 'live' and not settings.local_demo_ai.allow_live:
            return await error_response(run, 'live_provider_disabled', 'Реальные вызовы модели для локального API выключены', 503)(scope, receive, send)
        limit = MANUAL_BODY_BYTES if path.endswith('/from-images') else PREPARED_BODY_BYTES
        if is_expert:
            limit = expert_grading.MAX_BODY_BYTES
        lengths = headers.getlist('content-length')
        if method == 'POST' and lengths:
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
                return await error_response(run, 'invalid_multipart', 'Некорректный размер запроса', 422)(scope, receive, send)
            if len(lengths[0]) > 12 or int(lengths[0]) > limit:
                return await error_response(run, 'upload_too_large', 'Общий размер фотографий слишком большой', 413)(scope, receive, send)
        if method == 'POST':
            if scope['app'].state.photo_active >= settings.photo.concurrency:
                return await error_response(run, 'grading_busy', 'Сервис занят. Попробуй позже', 429)(scope, receive, send)
            try:
                run.trace = self.store.start(run.run_id, provider_mode=run.provider_mode)
            except ServiceError as exc:
                return await error_response(run, exc.code, exc.message, exc.status_code)(scope, receive, send)
        scope.setdefault('state', {})['grading_v2_run'] = run
        scope['headers'] = [(key, value) for key, value in scope['headers'] if key.lower() != b'x-request-id']
        scope['headers'].append((b'x-request-id', run.run_id.encode('ascii')))
        received, started, body_error = 0, False, None

        async def bounded_receive():
            nonlocal received, body_error
            message = await receive()
            if message['type'] == 'http.disconnect':
                body_error = InternalGradingError('upload_disconnected', 'Загрузка фотографий прервана', 400)
                run.body_error = body_error
                return message
            received += len(message.get('body', b''))
            if received > limit:
                body_error = InternalGradingError('upload_too_large', 'Общий размер фотографий слишком большой', 413)
                run.body_error = body_error
                raise body_error
            return message

        async def stamped_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
                extra = {key.lower().encode(): value.encode() for key, value in run.headers().items()}
                message = {**message, 'headers': [(key, value) for key, value in message.get('headers', [])
                                                   if key.lower() not in extra] + list(extra.items())}
            await send(message)

        try:
            async with asyncio.timeout(min(settings.photo.deadline_seconds, 360)):
                await self.app(scope, bounded_receive, stamped_send)
        except BaseException as exc:
            if started:
                raise
            if isinstance(exc, asyncio.CancelledError):
                finish_failure(run, 'cancelled', cancelled=True)
                raise
            if body_error is not None:
                error = body_error
            elif isinstance(exc, TimeoutError):
                error = InternalGradingError('llm_timeout', 'Проверка не завершилась за отведённое время', 504)
            elif isinstance(exc, ClientDisconnect):
                error = InternalGradingError('upload_disconnected', 'Загрузка фотографий прервана', 400)
            elif isinstance(exc, ServiceError):
                error = exc
            elif isinstance(exc, Exception):
                error = InternalGradingError('internal_error', 'Не удалось завершить проверку', 500)
            else:
                raise
            finish_failure(run, error)
            await error_response(run, error.code, error.message, error.status_code, error=error)(scope, receive, send)


@router.get('/capabilities')
async def capabilities(request: Request):
    run = request.state.grading_v2_run
    return JSONResponse({'contract_version': CONTRACT_VERSION, 'provider_mode': run.provider_mode,
                         'deadline_seconds': min(run.settings.photo.deadline_seconds, 360),
                         'concurrency': run.settings.photo.concurrency,
                         'available_run_records': request.app.state.grading_v2_store.available_records(),
                         'input_modes': ['prepared', 'from-images'], 'live_calls_allowed': run.settings.local_demo_ai.allow_live,
                         'grade_analysis': {'path': INTERNAL_PATH + '/grade-analysis',
                                            'contract_version': expert_grading.CONTRACT_VERSION},
                         'max_solution_images': 4, 'max_image_bytes': MAX_IMAGE_BYTES,
                         'artifact_ttl_seconds': TTL_SECONDS, 'max_diagram_artifacts': MAX_DIAGRAMS,
                         'max_artifact_bytes': MAX_ARTIFACT_BYTES,
                         'tasks': [package_descriptor(number) for number in MAX_SCORES]})


@router.post('/grade-analysis')
async def grade_expert_analysis(request: Request):
    run = request.state.grading_v2_run
    if request.app.state.photo_active >= run.settings.photo.concurrency:
        finish_failure(run, 'grading_busy')
        raise InternalGradingError('grading_busy', 'Сервис занят. Попробуй позже', 429)
    request.app.state.photo_active += 1
    try:
        with run.trace.stage('input'):
            if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
                raise InternalGradingError('invalid_expert_analysis', 'Нужен JSON экспертного анализа')
            prepared = expert_grading.parse_request(await request.body(), local_v2=True)
            number = prepared.task.task_number
            if number not in SUPPORTED_TASKS:
                raise InternalGradingError('unsupported_task', 'Проверка этого задания пока недоступна')
            selected = package_descriptor(number)
            if not selected['supported']:
                raise InternalGradingError('unsupported_task', 'Проверка этого задания пока недоступна')
            if prepared.task.max_score != selected['max_score']:
                raise InternalGradingError('invalid_task_snapshot', 'Максимальный балл не совпадает с заданием')
            try:
                package = load_package(number)
            except (OSError, UnicodeError):
                raise InternalGradingError('grading_package_changed', 'Пакет проверки изменился. Попробуй позже', 503) from None
            if package_digest(package) != selected['package_id']:
                raise InternalGradingError('grading_package_changed', 'Пакет проверки изменился. Попробуй позже', 503)
            run.package_id = selected['package_id']
            request.app.state.grading_v2_store.set_package(run.run_id, run.package_id)
        with run.trace.stage('grading'):
            raw = await expert_grading.grade_analysis(prepared, run.settings, package, trace=run.trace)
        with run.trace.stage('validation'):
            if package_descriptor(number)['package_id'] != run.package_id:
                raise InternalGradingError('grading_package_changed', 'Пакет проверки изменился. Попробуй позже', 503)
            value = expert_grading.validate_grade(raw, prepared.task.max_score)
            artifact_id = run.trace.add_json('grading', value.grading.model_dump())
        run.trace.emit('completed', 'validation', {'is_graded': True, 'artifact_id': artifact_id})
        return Response(raw, media_type='application/json')
    except ServiceError as exc:
        finish_failure(run, exc)
        return error_response(run, exc.code, exc.message, exc.status_code, error=exc)
    except Exception:
        if run.body_error is not None:
            finish_failure(run, run.body_error)
            raise run.body_error from None
        finish_failure(run, 'internal_error')
        raise
    finally:
        request.app.state.photo_active -= 1


async def grade_request(request, *, manual=False):
    run = request.state.grading_v2_run
    if request.app.state.photo_active >= run.settings.photo.concurrency:
        finish_failure(run, 'grading_busy')
        raise InternalGradingError('grading_busy', 'Сервис занят. Попробуй позже', 429)
    request.app.state.photo_active += 1
    try:
        with run.trace.stage('input'):
            if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'multipart/form-data':
                raise InternalGradingError('invalid_multipart', 'Нужны данные задачи и фотографии решения')
            try:
                async with request.form(max_files=5 if manual else 4, max_fields=1,
                                        max_part_size=MAX_METADATA_BYTES) as form:
                    required = {'metadata', 'solution_images'} | ({'task_image'} if manual else set())
                    if set(form.keys()) != required:
                        raise InternalGradingError('invalid_multipart', 'Некорректные поля запроса')
                    metadata = form.getlist('metadata')
                    if len(metadata) != 1 or type(metadata[0]) is not str:
                        raise InternalGradingError('invalid_task_snapshot', 'Некорректные данные задачи')
                    data = parse_metadata(metadata[0], manual=manual)
                    image_ids = data['solution_image_ids']
                    number = data['task_number'] if manual else data['task']['task_number']
                    if number not in MAX_SCORES:
                        raise InternalGradingError('unsupported_task', 'Проверка этого задания пока недоступна')
                    selected = package_descriptor(number)
                    if not selected['supported']:
                        raise InternalGradingError('unsupported_task', 'Проверка этого задания пока недоступна')
                    if not manual and data['task']['max_score'] != selected['max_score']:
                        raise InternalGradingError('invalid_task_snapshot', 'Максимальный балл не совпадает с заданием')
                    run.package_id = selected['package_id']
                    request.app.state.grading_v2_store.set_package(run.run_id, run.package_id)
                    uploads = form.getlist('solution_images')
                    task_uploads = form.getlist('task_image') if manual else []
                    if (len(uploads) != len(image_ids) or (manual and len(task_uploads) != 1)
                            or not all(isinstance(item, UploadFile) for item in uploads + task_uploads)):
                        raise InternalGradingError('invalid_task_snapshot', 'Число фотографий не совпадает с идентификаторами')
                    images = []
                    for upload in task_uploads + uploads:
                        payload = await upload.read(MAX_IMAGE_BYTES + 1)
                        if len(payload) > MAX_IMAGE_BYTES:
                            raise InternalGradingError('upload_too_large', 'Каждая фотография должна быть не больше 8 МБ', 413)
                        images.append(await asyncio.to_thread(sanitize, payload))
            except HTTPException:
                raise InternalGradingError('invalid_multipart', 'Некорректная загрузка фотографий') from None
            run.trace.solution_image_ids = list(image_ids)
        from app.grading import v2_service

        if manual:
            raw = await v2_service.run_from_images(run.settings, data, images[0], images[1:], run.trace)
            task = run.trace.task_snapshot
            if (type(task) is not dict or task.get('id') != data['task_id']
                    or type(task.get('task_number')) is not int or task['task_number'] != number
                    or type(task.get('max_score')) is not int or task['max_score'] != MAX_SCORES[number]):
                raise LLMResponseFormatError('Результат не соответствует отправленной задаче')
        else:
            task = data['task']
            raw = await v2_service.run_prepared(run.settings, task, image_ids, images, run.trace)
        with run.trace.stage('validation'):
            if package_descriptor(number)['package_id'] != run.package_id:
                raise InternalGradingError('grading_package_changed', 'Пакет проверки изменился. Попробуй позже', 503)
            if v2_service.validate_final(raw, task, image_ids, run.trace):
                raise LLMResponseFormatError('Модель вернула неверный формат результата')
            value = parse_response(raw)
            if value['task'] != task or value['solution_image_ids'] != image_ids:
                raise LLMResponseFormatError('Результат не соответствует отправленной задаче')
            artifact_id = run.trace.add_json('final', value)
        run.trace.emit('completed', 'validation', {'is_graded': value['is_graded'], 'artifact_id': artifact_id})
        return Response(raw, media_type='application/json')
    except asyncio.CancelledError:
        # The outer deadline reports its actual cause; the slot is released immediately.
        raise
    except ServiceError as exc:
        finish_failure(run, exc)
        return error_response(run, exc.code, exc.message, exc.status_code, error=exc)
    except Exception:
        if run.body_error is not None:
            finish_failure(run, run.body_error)
            raise run.body_error from None
        finish_failure(run, 'internal_error')
        raise InternalGradingError('internal_error', 'Не удалось завершить проверку', 500) from None
    finally:
        request.app.state.photo_active -= 1


@router.post('')
async def prepared(request: Request):
    return await grade_request(request)


@router.post('/from-images')
async def from_images(request: Request):
    return await grade_request(request, manual=True)


@router.delete('/runs/{run_id}')
async def acknowledge_run(request: Request, run_id: str):
    request.app.state.grading_v2_store.acknowledge(run_id)
    return Response(status_code=204)


@router.get('/runs/{run_id}/events')
async def events(request: Request, run_id: str):
    query = request.query_params
    if set(query) - {'after', 'limit'} or any(len(query.getlist(key)) > 1 for key in query):
        raise InternalGradingError('invalid_cursor', 'Некорректный курсор событий')
    try:
        after, limit = query.get('after', '0'), query.get('limit', '100')
        if not all(value.isascii() and value.isdigit() and len(value) <= 10 for value in (after, limit)):
            raise ValueError
        return JSONResponse(request.app.state.grading_v2_store.events(run_id, after=int(after), limit=int(limit)))
    except ValueError:
        raise InternalGradingError('invalid_cursor', 'Некорректный курсор событий') from None


@router.get('/runs/{run_id}/artifacts/{artifact_id}')
async def artifact(request: Request, run_id: str, artifact_id: str):
    stored = request.app.state.grading_v2_store.artifact(run_id, artifact_id)
    return Response(stored.data, media_type=stored.media_type,
                    headers={'X-Content-Type-Options': 'nosniff',
                             'Content-Disposition': 'attachment; filename="artifact"'})
