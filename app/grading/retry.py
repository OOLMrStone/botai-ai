"""One retry budget per validated v2 step, with bounded public diagnostics."""
import asyncio
from collections import Counter
import re

from app.core.errors import (LLMError, LLMResponseFormatError, LLMTimeoutError,
                             LLMRateLimitError, LLMConfigError, LLMBadRequestError, ServiceError)

MAX_ATTEMPTS = 4
CATEGORIES = {'input': 3, 'network': 4, 'provider': 5, 'model_response': 6,
              'configuration': 7, 'timeout': 8, 'internal': 9}
PHASES = {'input', 'preparation', 'ocr', 'diagrams', 'layout', 'analysis', 'grading', 'validation'}
CODE = re.compile(r'^[a-z][a-z0-9_]{0,63}$')
STEP = re.compile(r'^[a-z][a-z0-9_.-]{0,95}$')
PATH = re.compile(r'^\$(?:\.[a-z_][a-z0-9_]*|\[\d{1,5}\]){0,20}$')
ISSUES = {'missing_source_lines', 'duplicate_source_lines', 'unknown_source_lines', 'source_line_order',
          'unicode_math_script', 'composite_slash_fraction', 'ocr_doubt_invalid_marker', 'ocr_doubt_limit',
          'ocr_doubt_no_consensus', 'invalid_stage_response', 'empty_response', 'answer_recheck', 'transcript_bounds'}


def safe_diagnostics(data):
    if type(data) is not dict:
        return {}
    result = {}
    category, number = data.get('failure_category'), data.get('diagnostic_code')
    if type(category) is str and category in CATEGORIES and type(number) is int and number // 100 == CATEGORIES[category]:
        result.update(failure_category=category, diagnostic_code=number)
    for key, pattern in (('reason_code', CODE), ('step', STEP)):
        if type(data.get(key)) is str and pattern.fullmatch(data[key]):
            result[key] = data[key]
    if type(data.get('phase')) is str and data['phase'] in PHASES:
        result['phase'] = data['phase']
    if type(data.get('attempt')) is int and 1 <= data['attempt'] <= MAX_ATTEMPTS:
        result['attempt'] = data['attempt']
    if type(data.get('max_attempts')) is int and data['max_attempts'] == MAX_ATTEMPTS:
        result['max_attempts'] = MAX_ATTEMPTS
    for key in ('retryable', 'exhausted'):
        if type(data.get(key)) is bool:
            result[key] = data[key]
    if type(data.get('failure_counts')) is dict:
        result['failure_counts'] = {k: v for k, v in data['failure_counts'].items()
                                    if k in CATEGORIES and type(v) is int and 0 <= v <= MAX_ATTEMPTS}
    for key, pattern in (('issue_codes', CODE), ('issue_paths', PATH)):
        if type(data.get(key)) is list:
            result[key] = [v for v in data[key][:30] if type(v) is str and pattern.fullmatch(v)]
    return result


def invalid_response(message, errors=None, reason=None):
    errors = errors or []
    codes = list(dict.fromkeys(e.split(':', 2)[1].strip() for e in errors
                 if len(e.split(':', 2)) > 1 and e.split(':', 2)[1].strip() in ISSUES))
    paths = list(dict.fromkeys(e.split(':', 1)[0] for e in errors if e.startswith('$')))
    return LLMResponseFormatError(message, details=safe_diagnostics({
        'reason_code': reason or (codes[0] if codes else 'invalid_stage_response'),
        'issue_codes': codes or [reason or 'invalid_stage_response'], 'issue_paths': paths}))


def classify(exc, phase='input'):
    details = safe_diagnostics(getattr(exc, 'details', {}))
    reason = getattr(exc, 'details', {}).get('provider_failure') or details.get('reason_code')
    if isinstance(exc, LLMResponseFormatError):
        category, number = 'model_response', 601
        if reason == 'provider_output_truncated': number = 602
        elif reason in ('provider_empty_choices', 'empty_response'): number = 603
        elif reason in ('ocr_doubt_no_consensus', 'ocr_doubt_invalid_marker', 'ocr_doubt_limit'): number = 604
        elif reason in ('unicode_math_script', 'composite_slash_fraction'): number = 605
        elif reason in ('missing_source_lines', 'duplicate_source_lines', 'unknown_source_lines', 'source_line_order'): number = 606
        elif phase == 'analysis': number = 607
        elif phase == 'grading': number = 608
    elif isinstance(exc, LLMTimeoutError):
        category, number, reason = 'network', 402, reason or 'provider_timeout'
    elif reason == 'provider_connection_error':
        category, number = 'network', 401
    elif isinstance(exc, LLMRateLimitError):
        category, number, reason = 'provider', 501, reason or 'provider_rate_limit'
    elif isinstance(exc, LLMConfigError):
        category, number, reason = 'configuration', 701, reason or 'provider_authentication'
    elif isinstance(exc, LLMBadRequestError):
        category, number, reason = 'configuration', 702, reason or 'provider_bad_request'
    elif isinstance(exc, LLMError):
        category, number, reason = 'provider', 502, reason or 'provider_error'
    elif getattr(exc, 'code', '') in {'live_provider_disabled', 'grading_package_changed', 'service_unauthorized', 'unsupported_contract'}:
        category, number, reason = 'configuration', 703, exc.code
    elif getattr(exc, 'code', '') == 'grading_busy':
        category, number, reason = 'internal', 902, 'grading_busy'
    elif getattr(exc, 'code', '') == 'run_store_full':
        category, number, reason = 'internal', 903, 'run_store_full'
    elif getattr(exc, 'code', '') == 'upload_disconnected':
        category, number, reason = 'network', 403, 'upload_disconnected'
    elif isinstance(exc, TimeoutError) or getattr(exc, 'code', '') == 'llm_timeout':
        category, number, reason = 'timeout', 801, 'run_deadline_exceeded'
    elif isinstance(exc, ServiceError) and 400 <= exc.status_code < 500:
        category, number, reason = 'input', 301, exc.code
    else:
        category, number, reason = 'internal', 901, 'internal_error'
    return {**details, 'failure_category': category, 'diagnostic_code': number,
            'reason_code': reason if type(reason) is str and CODE.fullmatch(reason) else 'invalid_stage_response',
            'phase': phase, 'retryable': isinstance(exc, LLMResponseFormatError) or bool(getattr(exc, 'retryable', False))}


async def run_step(trace, phase, step, operation):
    """Retry this operation only; cancellation and programming errors escape immediately."""
    counts = Counter()
    for attempt in range(1, MAX_ATTEMPTS + 1):
        context = {'phase': phase, 'step': step, 'attempt': attempt, 'max_attempts': MAX_ATTEMPTS,
                   'failure_counts': dict(counts)}
        if trace is not None:
            trace.step_context = context
        try:
            result = await operation(attempt)
        except LLMError as exc:
            facts = classify(exc, phase)
            counts[facts['failure_category']] += 1
            exhausted = attempt == MAX_ATTEMPTS
            facts.update(context, failure_counts=dict(counts), exhausted=exhausted)
            exc.details = {**exc.details, **facts}
            if trace is not None:
                trace.step_context = facts
                if getattr(exc, '_trace_unavailable', False):
                    raise
                if isinstance(exc, LLMResponseFormatError):
                    try:
                        trace.emit('validation_failed', phase, {**facts, 'valid': False, 'code': exc.code})
                    except ServiceError:
                        raise exc from None
            if exhausted or not facts['retryable']:
                raise
            if trace is not None:
                try:
                    trace.emit('retry', phase, {**facts, 'attempt': attempt + 1, 'exhausted': False,
                                               'code': facts['reason_code']})
                except ServiceError:
                    raise exc from None
            if facts['failure_category'] != 'model_response':
                await asyncio.sleep(min(0.25 * 2 ** (attempt - 1), 1))
        else:
            if trace is not None:
                trace.step_context = {}
            return result
