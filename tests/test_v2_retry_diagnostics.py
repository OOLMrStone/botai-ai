"""Public failure facts survive the HTTP boundary without private provider material."""
import asyncio
from uuid import uuid4

import pytest

from app.core.errors import LLMError, LLMResponseFormatError
from app.grading.observability import RunStore
from app.grading.retry import classify, invalid_response, run_step, safe_diagnostics
from app.grading.internal_contract import InternalGradingError
from app.api.routes_grading_v2 import RunContext, error_response, finish_failure


@pytest.mark.parametrize('code,category,number', [
    ('live_provider_disabled', 'configuration', 703),
    ('grading_package_changed', 'configuration', 703),
    ('grading_busy', 'internal', 902),
    ('run_store_full', 'internal', 903),
    ('upload_disconnected', 'network', 403),
    ('llm_timeout', 'timeout', 801),
])
def test_non_model_failures_are_not_guessed_as_bad_model_output(code, category, number):
    facts = classify(InternalGradingError(code, 'private', 503), 'input')
    assert (facts['failure_category'], facts['diagnostic_code']) == (category, number)
    assert 'attempt' not in facts
    if code == 'run_store_full':
        assert facts['reason_code'] == 'run_store_full'
        assert facts['retryable'] is False


async def test_four_failures_reach_terminal_event_and_http_without_private_details(settings):
    trace = RunStore().start(str(uuid4()), provider_mode='mock')
    run = RunContext(trace.run_id, settings, 'mock', trace=trace)
    async def fail(attempt):
        if attempt % 2:
            raise LLMError('safe', details={'provider_failure': 'provider_connection_error',
                                          'raw_response': 'private model response', 'api_key': 'private key'})
        raise invalid_response('safe', ['$: unicode_math_script: private text'])
    with pytest.raises(LLMResponseFormatError) as error:
        with trace.stage('ocr'):
            await run_step(trace, 'ocr', 'ocr.photo.1.strip.2', fail)
    finish_failure(run, error.value)
    response = error_response(run, error.value.code, error.value.message, 502, error=error.value)
    terminal = trace.store.events(trace.run_id)['items'][-1]
    facts = terminal['data']
    assert terminal['phase'] == 'ocr' and terminal['type'] == 'failed'
    assert facts['attempt'] == facts['max_attempts'] == 4 and facts['exhausted']
    assert facts['failure_counts'] == {'network': 2, 'model_response': 2}
    assert facts['diagnostic_code'] == 605 and facts['issue_codes'] == ['unicode_math_script']
    assert b'private' not in response.body
    assert b'failure_counts' in response.body and b'ocr.photo.1.strip.2' in response.body


async def test_deadline_during_later_attempt_preserves_counts_without_claiming_four_failures(settings):
    trace = RunStore().start(str(uuid4()), provider_mode='mock')
    run = RunContext(trace.run_id, settings, 'mock', trace=trace)
    async def operation(attempt):
        if attempt == 1:
            raise invalid_response('bad', reason='empty_response')
        await asyncio.Event().wait()
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(.01):
            with trace.stage('analysis'):
                await run_step(trace, 'analysis', 'analysis', operation)
    error = InternalGradingError('llm_timeout', 'Deadline', 504)
    finish_failure(run, error)
    terminal = trace.store.events(trace.run_id)['items'][-1]
    assert terminal['phase'] == 'analysis'
    facts = terminal['data']
    assert facts['failure_category'] == 'timeout' and facts['diagnostic_code'] == 801
    assert facts['attempt'] == 2 and facts['failure_counts'] == {'model_response': 1}
    assert not facts.get('exhausted', False)


def test_safe_diagnostics_are_bounded_and_type_strict():
    assert safe_diagnostics({'failure_category': ['network'], 'diagnostic_code': 401,
                             'attempt': True, 'max_attempts': 40, 'step': '/private/file',
                             'phase': ['ocr'], 'raw_response': 'private'}) == {}
    facts = safe_diagnostics({'failure_category': 'network', 'diagnostic_code': 601,
                             'issue_paths': ['$.ocr', '/private/file', '$.with spaces'],
                             'failure_counts': {'network': True, 'model_response': 4, 'private': 3}})
    assert 'diagnostic_code' not in facts
    assert facts['issue_paths'] == ['$.ocr'] and facts['failure_counts'] == {'model_response': 4}


@pytest.mark.parametrize('bad', ['x' * 16001, '\n'.join(['x'] * 2001)])
async def test_join_checks_downstream_layout_limits_inside_its_retry_budget(bad):
    from app.grading.v2_service import _transcribe, ObservedProvider
    class Reader:
        calls = 0
        async def transcribe(self, *args):
            self.calls += 1
            return bad if self.calls < 4 else 'x > 0'
    trace = RunStore().start(str(uuid4()), provider_mode='mock')
    reader = Reader()
    value = await _transcribe(ObservedProvider(reader, trace, 'ocr'), trace, 'read',
                              step='ocr.join', joined=True)
    assert value == 'x > 0' and reader.calls == 4
    failures = [e for e in trace.store.events(trace.run_id)['items'] if e['type'] == 'validation_failed']
    assert [e['data']['attempt'] for e in failures] == [1, 2, 3]
    assert all(e['data']['issue_codes'] == ['transcript_bounds'] for e in failures)
