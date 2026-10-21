"""Completion causes survive console logging and safe v2 events, without model text."""
import logging
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.core.errors import LLMResponseFormatError
from app.core.logging import ConsoleFormatter
from app.grading.observability import RunStore
from app.grading.provider import Provider, log_usage
from app.grading.v2_service import ObservedProvider


@pytest.mark.parametrize('operation,limit', [('chat', 16000), ('chat_override', 32000), ('transcribe', 8000)])
@pytest.mark.parametrize('finish,cause', [('length', 'provider_output_truncated'),
                                       (None, 'provider_empty_choices')])
async def test_completion_failure_preserves_specific_cause_in_safe_events(caplog, operation, limit, finish, cause):
    completion = NS(choices=[NS(finish_reason=finish, message='private model text')] if finish else [],
                    usage=NS(prompt_tokens=42, completion_tokens=limit,
                             completion_tokens_details=NS(reasoning_tokens=limit-1)))
    provider = object.__new__(Provider)
    provider.settings = NS(model='test-model', max_output_tokens=16000, extra_body=None)
    create = AsyncMock(return_value=completion)
    provider.client = NS(chat=NS(completions=NS(create=create)))
    trace = RunStore().start(str(uuid4()), provider_mode='mock')
    observed = ObservedProvider(provider, trace, 'analysis')
    with caplog.at_level(logging.INFO, logger='app.grading.provider'):
        with pytest.raises(LLMResponseFormatError) as error:
            if operation.startswith('chat'):
                budget = {'max_output_tokens': limit} if operation == 'chat_override' else {}
                await observed.chat([{'role': 'user', 'content': 'private prompt'}], **budget)
            else:
                await observed.transcribe('private prompt')
    assert error.value.code == 'llm_bad_response'
    assert error.value.details == {'provider_failure': cause, 'output_limit': limit}
    assert create.await_count == 1
    assert create.call_args.kwargs['max_tokens'] == limit
    assert provider.settings.max_output_tokens == 16000
    event = trace.store.events(trace.run_id)['items'][-1]
    assert event['type'] == 'model_failed' and event['data']['error_code'] == cause
    record = next(r for r in caplog.records if r.name == 'app.grading.provider')
    record.request_id = 'test-request'
    text = ConsoleFormatter().format(record)
    assert f'finish_reason={finish or "missing_choices"}' in text
    assert f'output_limit={limit}' in text
    assert 'private' not in text and 'private' not in str(event)


@pytest.mark.parametrize('finish', ['private upstream value', {'private': 'value'}])
def test_usage_logging_does_not_accept_arbitrary_provider_strings(caplog, finish):
    completion = NS(choices=[NS(finish_reason=finish)],
                    usage=NS(prompt_tokens='private secret', completion_tokens=True,
                             completion_tokens_details=NS(reasoning_tokens=-1)))
    with caplog.at_level(logging.INFO, logger='app.grading.provider'):
        log_usage('reader', completion, 0, output_limit=8000)
    record = caplog.records[-1]
    assert record.finish_reason == 'other'
    assert record.prompt_tokens is record.completion_tokens is record.reasoning_tokens is None
    assert 'private' not in caplog.text
