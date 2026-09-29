"""Decode and re-encode uploads before any provider sees them; no remote URLs."""
import base64
from dataclasses import dataclass
from io import BytesIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ValidationError

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 20_000_000


@dataclass(frozen=True)
class SafeImage:
    data: bytes
    media_type: str = 'image/jpeg'

    def part(self) -> dict:
        return {'type': 'image_url', 'image_url': {
            'url': 'data:' + self.media_type + ';base64,' + base64.b64encode(self.data).decode(),
            'detail': 'high'}}


def sanitize(payload: bytes) -> SafeImage:
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise ValidationError('Каждая фотография должна быть непустой и не больше 8 МБ')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as image:
                if image.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise ValidationError('Поддерживаются фотографии JPEG, PNG и WebP')
                if image.width * image.height > MAX_PIXELS or max(image.size) > 8192:
                    raise ValidationError('Фото слишком большое: до 20 мегапикселей и 8192 пикселей по стороне')
                if getattr(image, 'n_frames', 1) != 1:
                    raise ValidationError('Нужно статичное фото, без анимации')
                image.load()
                cleaned = ImageOps.exif_transpose(image).convert('RGB')
                output = BytesIO()
                cleaned.save(output, format='JPEG', quality=95)
                if output.tell() > MAX_IMAGE_BYTES:
                    raise ValidationError('После обработки фото больше 8 МБ. Уменьши его размер')
                return SafeImage(output.getvalue())
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning,
            Image.DecompressionBombError) as exc:
        raise ValidationError('Не удалось открыть фотографию. Выбери корректный JPEG, PNG или WebP') from exc
