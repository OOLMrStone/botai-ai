"""Narrow OCR encoding checks; never rewrite or judge the student's mathematics."""
import re


_SCRIPT = re.compile(r'[²³¹ˣ⁰-⁹⁺⁻⁼⁽⁾ⁿ₀-₉]')
_FRACTION = re.compile(r'\([^()\n]{1,2000}\)\s*/\s*\([^()\n]{1,2000}\)')
_DIAGRAM = re.compile(
    r'\[\s*(интервальная\s+прямая|числовая\s+прямая|number_line|'
    r'тригонометрическая\s+окружность|unit_circle)\s*:', re.IGNORECASE
)

OCR_NOTATION_PROMPT = r'''
Математические записи передавай в TeX внутри $...$ или $$...$$: степени через ^{...},
индексы через _{...}, составные дроби через \frac{...}{...}, а не Unicode-степени
или плоскую запись (числитель)/(знаменатель). Сохраняй исходные знаки, показатели,
скобки и ошибки ученика; меняется только формат записи, не математика.
Описание числовой прямой начинай [числовая прямая: ...], тригонометрической
окружности - [тригонометрическая окружность: ...]; сохраняй все видимые детали.'''


def math_notation_errors(text: str) -> list[str]:
    """Detect only explicit scripts and parenthesized composite slash fractions.

    Simple ASCII mathematics, prose and uncertainty markers remain valid. This
    is not a general TeX validator: source transcription is never normalized.
    """
    errors = []
    if _SCRIPT.search(text):
        errors.append('$: unicode_math_script: encode visible scripts as TeX, preserving their scope')
    if _FRACTION.search(text):
        errors.append('$: composite_slash_fraction: encode the visible fraction as TeX without changing its terms')
    return errors


def transcript_errors(text: str) -> list[str]:
    """Validate the transcript before layout, including fragment replacement boundaries."""
    lines = [line for line in text.splitlines() if line.strip()]
    errors = math_notation_errors(text)
    if not lines or len(lines) > 2000 or len(text) > 200_000 or any(len(line) > 16000 for line in lines):
        errors.append('$.ocr: transcript_bounds: transcript must fit the layout limits')
    return errors


def native_diagram_kinds(text: str) -> set[str]:
    """Only an explicit bracketed OCR marker requires a native figure."""
    return {'unit_circle' if 'окружность' in match[1].casefold() or match[1].casefold() == 'unit_circle'
            else 'number_line' for match in _DIAGRAM.finditer(text)}
