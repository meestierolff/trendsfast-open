"""Typed errors for every way a TrendsFast call can end without a result.

Each keeps the request ID it belongs to, so the outcome of a paid call can always be read with
``recover(request_id)`` instead of sending it again under a new ID. ``exit_code`` is what the
``trendsfast`` CLI exits with.
"""
from typing import Any, Dict, Optional, Tuple, Type

from ._catalog import CATALOG

EXIT_CODES: Dict[str, int] = dict(CATALOG["exit_codes"])


class TrendsFastError(Exception):
    """Base class. ``code`` is TrendsFast's error code (or a local one), ``status`` the HTTP
    status (0 when no answer arrived or the error was raised locally)."""

    def __init__(
        self,
        code: str,
        message: str,
        kind: str,
        status: int = 0,
        request_id: Optional[str] = None,
        result_id: Optional[str] = None,
        recovery: Optional[str] = None,
        retry_after_seconds: Optional[int] = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.kind = kind
        self.status = status
        self.request_id = request_id
        self.result_id = result_id
        self.recovery = recovery
        self.retry_after_seconds = retry_after_seconds
        self.body = body

    @property
    def retryable(self) -> bool:
        return self.kind in ("rate_limited", "network", "unconfirmed")

    @property
    def exit_code(self) -> int:
        return EXIT_CODES[self.kind]


class AuthRequiredError(TrendsFastError):
    """401: the key is missing, invalid, expired or revoked."""


class InsufficientScopeError(TrendsFastError):
    """403: the key lacks the scope this call needs."""


class InsufficientCreditsError(TrendsFastError):
    """402: the balance cannot cover the call. Nothing was charged."""


class CreditQuoteExceedsLimitError(TrendsFastError):
    """402: max_credits is below the call's price. Nothing was charged."""


class IdempotencyConflictError(TrendsFastError):
    """409: this request ID was already used with different input."""


class ContextNotCurrentError(TrendsFastError):
    """409: the context_id is not the brand's current confirmed context."""


class ProductRequiresContextError(TrendsFastError):
    """400: a product runs on the brand's confirmed context."""


class ResultUnavailableError(TrendsFastError):
    """410: the result expired, its brand context changed, or its evidence was removed."""


class RateLimitedError(TrendsFastError):
    """429: too many calls. Nothing was started."""


class OutcomeUnconfirmedError(TrendsFastError):
    """The call may have run. Read it with recover(request_id); never resend under a new ID."""


class InvalidRequestError(TrendsFastError):
    """Any other refusal of the input. Nothing was started."""


class ConflictError(TrendsFastError):
    """Any other conflict (409) or gone (410), such as a paused account."""


class ServiceUnavailableError(TrendsFastError):
    """No answer, or a server failure, on a call that cannot have charged anything."""


_CLASSES: Dict[str, Type[TrendsFastError]] = {
    cls.__name__: cls
    for cls in (
        AuthRequiredError,
        InsufficientScopeError,
        InsufficientCreditsError,
        CreditQuoteExceedsLimitError,
        IdempotencyConflictError,
        ContextNotCurrentError,
        ProductRequiresContextError,
        ResultUnavailableError,
        RateLimitedError,
        OutcomeUnconfirmedError,
        InvalidRequestError,
        ConflictError,
        ServiceUnavailableError,
    )
}

ERROR_CODE_CLASSES: Dict[str, Tuple[Type[TrendsFastError], str]] = {
    code: (_CLASSES[entry["class"]], entry["kind"]) for code, entry in CATALOG["error_codes"].items()
}
STATUS_KINDS: Dict[int, Tuple[Type[TrendsFastError], str]] = {
    int(status): (_CLASSES[entry["class"]], entry["kind"]) for status, entry in CATALOG["status_kinds"].items()
}

_MESSAGES = {
    "AUTH_REQUIRED": "TrendsFast did not accept the API key: it is missing, invalid, expired or revoked. Run `trendsfast login`, or set TRENDSFAST_API_KEY.",
    "INSUFFICIENT_SCOPE": "The API key lacks the scope this call needs.",
    "INSUFFICIENT_CREDITS": "The credit balance cannot cover this call. Nothing was charged.",
    "CREDIT_QUOTE_EXCEEDS_LIMIT": "max_credits is below this call's price. Nothing was charged.",
    "IDEMPOTENCY_CONFLICT": "This request ID was already used with different input. New input needs a new request ID.",
    "CONTEXT_NOT_CURRENT": "The context_id is not your brand's current confirmed context. Read it again with context().",
    "PRODUCT_REQUIRES_CONTEXT": "A product runs on your brand's confirmed context; read a niche you describe without one.",
    "RESULT_UNAVAILABLE": "The result is no longer available. Do not rebuild it from memory.",
    "RATE_LIMITED": "TrendsFast is limiting how fast this account can send calls. Nothing was started.",
    "REQUEST_OUTCOME_UNCONFIRMED": "TrendsFast could not confirm the outcome. Read it by its request ID before sending anything new.",
    "REQUEST_IN_PROGRESS": "An earlier call with this request ID is still running. Read it again later.",
    "EFFECT_UNKNOWN": "TrendsFast does not know whether this call completed. Read it again later; never resend it under a new ID.",
    "REQUEST_RELEASED": "The call with this request ID ended without a result or a charge. Send it again with a new request ID.",
    "V3_DISABLED": "The TrendsFast V3 API is not available on this deployment.",
}


def error_from_response(
    status: int, body: Any, request_id: Optional[str] = None, retry_after_seconds: Optional[int] = None
) -> TrendsFastError:
    """The error TrendsFast's answer stands for."""
    code = body.get("error") if isinstance(body, dict) and isinstance(body.get("error"), str) else None
    recovery = body.get("recovery") if isinstance(body, dict) and isinstance(body.get("recovery"), str) else None
    mapped = ERROR_CODE_CLASSES.get(code) if code else None
    if mapped is None and code == "V3_DISABLED":
        mapped = (ServiceUnavailableError, "network")
    if mapped is None and code == "REQUEST_RELEASED":
        mapped = (ConflictError, "conflict")
    if mapped is None:
        mapped = STATUS_KINDS.get(status)
    if mapped is None:
        mapped = (ServiceUnavailableError, "network") if status >= 500 else (InvalidRequestError, "usage")
    cls, kind = mapped
    label = code or "HTTP_%d" % status
    message = _MESSAGES.get(code or "") or (
        "TrendsFast answered HTTP %d%s." % (status, " (%s)" % code if code else "")
        if status >= 500
        else "TrendsFast refused the call with HTTP %d%s." % (status, " (%s)" % code if code else "")
    )
    return cls(label, message, kind, status=status, request_id=request_id, recovery=recovery, retry_after_seconds=retry_after_seconds, body=body)
