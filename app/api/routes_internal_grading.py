"""Authenticated prepared-task grading, with no database or storage access."""
import asyncio
from dataclasses import dataclass
import hmac
import logging
from uuid import uuid4

from fastapi import APIRouter, Request
from starlette.datastructures import Headers, UploadFile
from starlette.exceptions import HTTPException
from starlette.requests import ClientDisconnect
from starlette.responses import JSONResponse, Response

from app.core.errors import LLMResponseFormatError, ServiceError
from app.grading.capabilities import select_capability
from app.grading.images import MAX_IMAGE_BYTES, sanitize
from app.grading.internal_contract import (
    CONTRACT_VERSION, INTERNAL_PATH, MAX_BODY_BYTES, MAX_METADATA_BYTES,
    MAX_SOLUTION_IMAGES, InternalGradingError, canonical_uuid, parse_metadata,
)
from app.grading.internal_reports import InternalReportSink

logger = logging.getLogger(__name__)
router = APIRouter(prefix=INTERNAL_PATH, tags=['internal grading'])


@dataclass
class InternalRun:
    request_id: str
    settings: object
    provider_mode: str
    report: InternalReportSink
    package_id: str = 'none'

    def headers(self):
        headers = {'X-Request-ID': self.request_id, 'Cache-Control': 'no-store',
                   'X-Grading-Contract-Version': CONTRACT_VERSION,
                   'X-Grading-Provider-Mode': self.provider_mode,
                   'X-Grading-Package-Id': self.package_id}
        if self.report.rejection_code:
            headers['X-Grading-Rejection-Code'] = self.report.rejection_code
        return headers


def error_response(run, code, message, status):
    return JSONResponse({'error': {'code': code, 'message': message, 'details': {}},
                         'request_id': run.request_id}, status_code=status, headers=run.headers())


class InternalGradingMiddleware:
    """Authenticate before body parsing and stamp every outcome with run metadata."""
    def __init__(self, app, settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or not (path == INTERNAL_PATH or path.startswith(INTERNAL_PATH + '/')):
            return await self.app(scope, receive, send)
        settings = self.settings.model_copy(deep=True)
        headers = Headers(scope=scope)
        ids = headers.getlist('x-request-id')
        valid_id = len(ids) == 1 and canonical_uuid(ids[0])
        request_id = ids[0] if valid_id else str(uuid4())
        run = InternalRun(request_id, settings, 'mock' if settings.llm.provider == 'mock' else 'live',
                          InternalReportSink(request_id))
        scope.setdefault('state', {})['internal_run'] = run
        # The existing request logger must never see a caller-controlled free-form ID.
        scope['headers'] = [(key, value) for key, value in scope['headers'] if key.lower() != b'x-request-id']
        scope['headers'].append((b'x-request-id', request_id.encode('ascii')))
        authorization = headers.getlist('authorization')
        secret = settings.internal_grading.token.get_secret_value()
        expected = ('Bearer ' + secret).encode('utf-8')
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0].encode('utf-8'), expected):
            response = error_response(run, 'service_unauthorized', 'Нет доступа к сервису проверки', 401)
            response.headers['WWW-Authenticate'] = 'Bearer'
            return await response(scope, receive, send)
        if path not in (INTERNAL_PATH, INTERNAL_PATH + '/capabilities'):
            return await error_response(run, 'not_found', 'Маршрут не найден', 404)(scope, receive, send)
        method = 'POST' if path == INTERNAL_PATH else 'GET'
        if scope['method'] != method:
            return await error_response(run, 'method_not_allowed', 'Метод не поддерживается', 405)(scope, receive, send)
        if method == 'POST' and not valid_id:
            return await error_response(run, 'invalid_request_id', 'Нужен UUID запуска проверки', 422)(scope, receive, send)
        lengths = headers.getlist('content-length')
        if lengths:
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
                return await error_response(run, 'invalid_multipart', 'Некорректный размер запроса', 422)(scope, receive, send)
            if len(lengths[0]) > 12 or int(lengths[0]) > MAX_BODY_BYTES:
                return await error_response(run, 'upload_too_large', 'Общий размер фотографий слишком большой', 413)(scope, receive, send)
        received = 0
        started = False
        body_error = None

        async def bounded_receive():
            nonlocal received, body_error
            message = await receive()
            if message['type'] == 'http.disconnect':
                body_error = InternalGradingError('upload_disconnected', 'Загрузка фотографий прервана', 400)
                return message
            received += len(message.get('body', b''))
            if received > MAX_BODY_BYTES:
                body_error = InternalGradingError('upload_too_large', 'Общий размер фотографий слишком большой', 413)
                raise body_error
            return message

        async def stamped_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
                extra = {key.lower().encode('ascii'): value.encode('ascii') for key, value in run.headers().items()}
                message = dict(message)
                message['headers'] = [(key, value) for key, value in message.get('headers', []) if key.lower() not in extra]
                message['headers'].extend(extra.items())
            await send(message)

        try:
            async with asyncio.timeout(settings.photo.deadline_seconds):
                await self.app(scope, bounded_receive, stamped_send)
        except (ServiceError, TimeoutError, ClientDisconnect) as exc:
            if started:
                raise
            if isinstance(exc, ServiceError):
                response = error_response(run, exc.code, exc.message, exc.status_code)
            elif isinstance(exc, ClientDisconnect):
                response = error_response(run, 'upload_disconnected', 'Загрузка фотографий прервана', 400)
            else:
                response = error_response(run, 'llm_timeout', 'Проверка не завершилась за отведённое время', 504)
            await response(scope, receive, send)
        except Exception as exc:
            if started:
                raise
            # BaseHTTPMiddleware can wrap a receive failure in an ExceptionGroup.
            # Preserve the authoritative streaming limit instead of returning 500.
            if body_error is not None:
                return await error_response(run, body_error.code, body_error.message, body_error.status_code)(scope, receive, send)
            # Exception text can contain transport data; record only a bounded category.
            logger.error('Internal grading failed', extra={'run_id': run.request_id, 'error_type': type(exc).__name__})
            await error_response(run, 'internal_error', 'Не удалось завершить проверку', 500)(scope, receive, send)


@router.get('/capabilities')
async def capabilities(request: Request):
    run = request.state.internal_run
    if run.settings.photo.deadline_seconds != 360:
        return error_response(run, 'unsupported_contract', 'Конфигурация проверки несовместима с контрактом', 503)
    return JSONResponse({'contract_version': CONTRACT_VERSION, 'provider_mode': run.provider_mode,
                         'deadline_seconds': 360,
                         'max_solution_images': MAX_SOLUTION_IMAGES, 'max_image_bytes': MAX_IMAGE_BYTES,
                         'tasks': [entry.descriptor() for entry in request.app.state.grading_capabilities.values()]})


@router.post('')
async def grade(request: Request):
    run = request.state.internal_run
    if request.app.state.photo_active >= run.settings.photo.concurrency:
        raise InternalGradingError('grading_busy', 'Сервис занят. Попробуй позже', 429)
    request.app.state.photo_active += 1
    try:
        if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'multipart/form-data':
            raise InternalGradingError('invalid_multipart', 'Нужны данные задачи и фотографии решения')
        try:
            async with request.form(max_files=MAX_SOLUTION_IMAGES, max_fields=1,
                                    max_part_size=MAX_METADATA_BYTES) as form:
                if set(form.keys()) != {'metadata', 'solution_images'}:
                    raise InternalGradingError('invalid_multipart', 'Нужны данные задачи и фотографии решения')
                metadata = form.getlist('metadata')
                uploads = form.getlist('solution_images')
                if len(metadata) != 1 or type(metadata[0]) is not str:
                    raise InternalGradingError('invalid_task_snapshot', 'Некорректные данные задачи')
                prepared = parse_metadata(metadata[0])
                if len(uploads) != len(prepared.solution_image_ids) or not all(isinstance(item, UploadFile) for item in uploads):
                    raise InternalGradingError('invalid_task_snapshot', 'Число фотографий не совпадает с идентификаторами')
                capability = select_capability(request.app.state.grading_capabilities, prepared.task)
                run.package_id = capability.package_id
                capability.check_unchanged()
                run.report.solution_image_ids = prepared.solution_image_ids
                images = []
                for upload in uploads:
                    payload = await upload.read(MAX_IMAGE_BYTES + 1)
                    if len(payload) > MAX_IMAGE_BYTES:
                        raise InternalGradingError('upload_too_large', 'Каждая фотография должна быть не больше 8 МБ', 413)
                    images.append(await asyncio.to_thread(sanitize, payload))
        except HTTPException:
            raise InternalGradingError('invalid_multipart', 'Некорректная загрузка фотографий') from None
        service = capability.handler_factory(run.settings, package=dict(capability.package))
        raw = await service.run_prepared(prepared.task, prepared.solution_image_ids, images, run.report.record)
        capability.check_unchanged()
        gate = capability.validator_factory(catalog_path=capability.catalog_path)
        if gate.validate(raw):
            raise LLMResponseFormatError('Модель вернула неверный формат результата')
        result = gate.finalize(raw)
        if result['task'] != prepared.task or result['solution_image_ids'] != prepared.solution_image_ids:
            raise LLMResponseFormatError('Результат не соответствует отправленной задаче')
        return Response(raw, media_type='application/json')
    finally:
        request.app.state.photo_active -= 1
