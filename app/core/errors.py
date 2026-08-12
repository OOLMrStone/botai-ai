"""Application error taxonomy.

Everything raised on purpose inherits from `ServiceError` so the HTTP layer can
turn it into a stable, machine-readable body without a pile of except clauses.
"""

from __future__ import annotations

from typing import Any


class ServiceError(Exception):
    """Base class for expected failures."""

    code = "internal_error"
    status_code = 500

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class ValidationError(ServiceError):
    code = "validation_error"
    status_code = 422


class UnknownTaskError(ValidationError):
    code = "unknown_task"


class NotFoundError(ServiceError):
    """Asked for something by id that is not (or no longer) held."""

    code = "not_found"
    status_code = 404


class DebugDisabledError(ServiceError):
    code = "debug_disabled"
    status_code = 404  # deliberately 404, not 403: do not advertise the surface


class DebugAuthError(ServiceError):
    code = "debug_forbidden"
    status_code = 403


class LLMError(ServiceError):
    code = "llm_error"
    status_code = 502
    #: Whether retrying the identical request could plausibly succeed.
    #: Timeouts and 5xx: yes. "Insufficient Balance", bad key, malformed
    #: request: no — retrying only delays the inevitable error by the backoff.
    retryable = True

    def __init__(
        self,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        retryable: bool | None = None,
    ) -> None:
        super().__init__(message, details=details)
        if retryable is not None:
            self.retryable = retryable


class LLMTimeoutError(LLMError):
    code = "llm_timeout"
    status_code = 504


class LLMRateLimitError(LLMError):
    code = "llm_rate_limited"
    status_code = 429


class LLMConfigError(LLMError):
    code = "llm_misconfigured"
    status_code = 500
    retryable = False


class LLMBadRequestError(LLMError):
    """A 4xx the provider blamed on our request.

    `param` carries the offending field name when the provider tells us one
    (`temperature`, `max_tokens`, `response_format`, ...), which is what lets
    the client drop that parameter and retry instead of failing the call.
    """

    code = "llm_bad_request"
    status_code = 502
    retryable = False

    def __init__(
        self,
        message: str,
        *,
        param: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message, details=details)
        self.param = param


class LLMResponseFormatError(LLMError):
    """The model answered, but not with the JSON we asked for."""

    code = "llm_bad_response"
    status_code = 502
