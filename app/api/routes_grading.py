"""Standalone test form API; no main-application identities are accepted."""
import asyncio
import json
import hashlib
import hmac
import re
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import Response, JSONResponse
from starlette.datastructures import UploadFile

from app.core.errors import LLMTimeoutError, ServiceError, ValidationError
from app.grading.images import MAX_IMAGE_BYTES, sanitize
from app.grading.service import GradingService

router = APIRouter(prefix='/api/v1/photo-check', tags=['standalone photo grading'])
MAX_BODY = 40 * 1024 * 1024 + 1024 * 1024


class UploadTooLarge(Exception):
    pass


class UploadLimitMiddleware:
    """Bound streaming bodies before multipart parsing, including missing Content-Length."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['path'] != '/api/v1/photo-check':
            return await self.app(scope, receive, send)
        count = 0
        async def bounded_receive():
            nonlocal count
            message = await receive()
            count += len(message.get('body', b''))
            if count > MAX_BODY:
                raise UploadTooLarge()
            return message
        try:
            await self.app(scope, bounded_receive, send)
        except UploadTooLarge:
            response = Response(json.dumps({'error': {'code': 'upload_too_large',
                'message': 'Можно приложить одно фото задачи и до четырёх фото решения, каждое до 8 МБ'}}, ensure_ascii=False),
                status_code=413, media_type='application/json')
            await response(scope, receive, send)


def test_identity(request: Request) -> tuple[str, str]:
    cookie = request.cookies.get('botai_test_user', '')
    user_id, _, signature = cookie.partition('.')
    secret = request.app.state.photo_identity_secret
    valid = bool(re.fullmatch(r'test-user-[0-9a-f]{32}', user_id))
    expected = hmac.new(secret, user_id.encode(), hashlib.sha256).hexdigest()
    if not valid or not hmac.compare_digest(signature, expected):
        user_id = 'test-user-' + uuid4().hex
        signature = hmac.new(secret, user_id.encode(), hashlib.sha256).hexdigest()
    return user_id, user_id + '.' + signature


def set_identity(response: Response, cookie: str, request: Request):
    response.set_cookie('botai_test_user', cookie, httponly=True, samesite='strict',
                        secure=request.url.scheme == 'https', max_age=30 * 86400)


@router.get('/config')
async def config(request: Request):
    settings = request.app.state.settings
    _, cookie = test_identity(request)
    response = JSONResponse({'mode': settings.llm.provider,
            'model': settings.llm.model if settings.llm.provider != 'mock' else 'mock',
            'deadline_seconds': settings.photo.deadline_seconds, 'max_solution_images': 4,
            'max_image_mb': 8, 'test_ids': True}, headers={'Cache-Control': 'no-store'})
    set_identity(response, cookie, request)
    return response


@router.post('')
async def check(request: Request):
    settings = request.app.state.settings
    # Refuse excess work instead of building an unbounded queue of image payloads.
    if request.app.state.photo_active >= settings.photo.concurrency:
        error = ServiceError('Сервис занят. Попробуй ещё раз немного позже')
        error.status_code, error.code = 429, 'grading_busy'
        raise error
    request.app.state.photo_active += 1
    try:
        async with asyncio.timeout(settings.photo.deadline_seconds):
            async with request.form(max_files=5, max_fields=0, max_part_size=MAX_IMAGE_BYTES) as form:
                if set(form.keys()) != {'task_image', 'solution_images'}:
                    raise ValidationError('Прикрепи одно фото условия и эталона, затем фотографии решения')
                tasks = form.getlist('task_image')
                solutions = form.getlist('solution_images')
                if len(tasks) != 1 or not 1 <= len(solutions) <= 4:
                    raise ValidationError('Нужно одно фото задачи и от одной до четырёх фотографий решения')
                images = []
                for upload in tasks + solutions:
                    if not isinstance(upload, UploadFile):
                        raise ValidationError('Ожидалась фотография')
                    payload = await upload.read(MAX_IMAGE_BYTES + 1)
                    images.append(await asyncio.to_thread(sanitize, payload))
            # This explicitly represents a local test user, never a database identity.
            user_id, cookie = test_identity(request)
            service = request.app.state.photo_service_factory(settings)
            raw = await service.run(images[0], images[1:], user_id)
            response = Response(raw, media_type='application/json', headers={'Cache-Control': 'no-store'})
            set_identity(response, cookie, request)
            return response
    except UploadTooLarge as exc:
        error = ValidationError('Можно приложить одно фото задачи и до четырёх фото решения, каждое до 8 МБ')
        error.status_code, error.code = 413, 'upload_too_large'
        raise error from exc
    except TimeoutError as exc:
        raise LLMTimeoutError('Проверка не завершилась за 4 минуты. Нажми «Проверить ещё раз»') from exc
    finally:
        request.app.state.photo_active -= 1
