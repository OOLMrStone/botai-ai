"""Real pinned KaTeX, synthetic inputs only: parsing, segmentation and process failure."""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app.grading.tex_validation import tex_errors, TexValidatorUnavailable
from app.grading.retry import classify


@pytest.mark.parametrize('text', [
    r'Обычный текст, цена 100 рублей и экранированный \$ символ',
    r'Ответ: $\frac{1}{2}$ и $$x^{2} + 1$$',
    r'$\frac{13\cancel{x}}{\cancel{x}}$',
    r'$2x^{\cancel{2}} = \cancel{x}1$',
    r'$\cancel{12}3 \ge n \ge \cancel{4}1$',
    r'Ответ: \(\sqrt{x}\), затем \[x \ne 0\]',
    r'\frac{1}{2}', 'x = 1', r'$\text{верно: } x\in\mathbb{R}$',
    'Незакрытый доллар $ остаётся текстом как во frontend',
    r'\$\unknowncommand\$',
])
async def test_same_frontend_segmentation_accepts_prose_and_valid_math(text):
    assert await tex_errors(text) == []


@pytest.mark.parametrize('text', [r'$\frac{1}{$', r'$$\notACommand{x}$$',
                                 r'\(x^^2\)', r'\[\left(x\]'])
async def test_real_parser_rejects_malformed_math(text):
    errors = await tex_errors({'summary': text})
    assert errors and all(error.startswith('$.summary: invalid_tex:') for error in errors)
    assert text not in str(errors)


async def test_recursive_fields_and_direct_diagram_label_are_checked():
    errors = await tex_errors({'analysis': {'summary': r'$\oops{}$'},
                              'grading': {'explanation': r'$x^^2$'},
                              'steps': [{'figure': {'kind': 'number_line', 'points': [
                                  {'value': r'\unknownCommand'}]}}]})
    assert {e.split(':')[0] for e in errors} == {
        '$.analysis.summary', '$.grading.explanation', '$.steps[0].figure.points[0].value'}


async def test_missing_node_is_infrastructure_and_not_model_output(monkeypatch):
    monkeypatch.setattr('app.grading.tex_validation.shutil.which', lambda _: None)
    with pytest.raises(TexValidatorUnavailable) as caught:
        await tex_errors('$x$')
    facts = classify(caught.value, 'ocr')
    assert facts['diagnostic_code'] == 704 and facts['failure_category'] == 'configuration'
    assert not facts['retryable']


@pytest.mark.parametrize('failure', ['timeout', 'cancel'])
async def test_child_is_killed_and_reaped_on_timeout_or_cancellation(monkeypatch, failure):
    class Process:
        returncode = None
        communicate = AsyncMock(side_effect=TimeoutError() if failure == 'timeout' else asyncio.CancelledError())
        wait = AsyncMock()
        def kill(self): self.returncode = -9
    process = Process()
    monkeypatch.setattr('app.grading.tex_validation.asyncio.create_subprocess_exec', AsyncMock(return_value=process))
    with pytest.raises(TexValidatorUnavailable if failure == 'timeout' else asyncio.CancelledError):
        await tex_errors('$x$')
    assert process.returncode == -9
    process.wait.assert_awaited_once()
