"""Only concrete OCR encoding defects trigger retries; source math is immutable."""
import pytest

from app.grading.v2_notation import math_notation_errors, native_diagram_kinds


@pytest.mark.parametrize('text', ['x>0', 'x = 0', 'x/y', 'x^2', '4≤5',
    'Дата 2026-10-16, задачи 1-2; и/или', 'x [неразборчиво: > | ≠] 0',
    r'$\frac{x^{3}+x^{2}-x-1}{4^{x^{2}}-8\cdot2^{x^{2}}+16}\ge0$',
    r'$\frac{x+1}{x-1}$', 'числовая прямая: рассуждение'])
def test_plain_math_and_tex_remain_valid_and_unchanged(text):
    original = text
    assert not math_notation_errors(text)
    assert text == original


@pytest.mark.parametrize('text', ['(x³ + x² - x - 1) / (4ˣ² - 8·2ˣ² + 16) ≥ 0',
    '$x²$', '$4ˣ²$', '(x+1)/(x-1)', '$(x+1)/(x-1)$'])
def test_specific_encoding_defects_are_rejected_without_source_in_diagnostics(text):
    original = text
    errors = math_notation_errors(text)
    assert errors and all(text not in error for error in errors)
    assert text == original


@pytest.mark.parametrize('text,expected', [
    ('[интервальная прямая: описание]', {'number_line'}),
    ('[ ЧИСЛОВАЯ  ПРЯМАЯ : описание]', {'number_line'}),
    ('[number_line: описание]', {'number_line'}),
    ('[тригонометрическая окружность: описание]', {'unit_circle'}),
    ('[unit_circle: описание]', {'unit_circle'}),
    ('Упоминается числовая прямая: рассуждение', set()),
    ('[числовая прямая] [number_line_extra: описание]', set()),
])
def test_only_explicit_diagram_markers_require_a_figure(text, expected):
    assert native_diagram_kinds(text) == expected
