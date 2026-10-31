"""TrendsFast for Python: source-backed market evidence for AI agents.

    from trendsfast import TrendsFast

    tf = TrendsFast()  # TRENDSFAST_API_KEY, or the key `trendsfast login` stored
    result = tf.customers(lookback_hours=168, limit=10)
"""
from ._catalog import PRODUCTS, READ_CREDITS
from ._version import __version__
from .client import TrendsFast, normalize_base_url, pick_filters
from .credentials import key_prefix
from .errors import (
    AuthRequiredError,
    ConflictError,
    ContextNotCurrentError,
    CreditQuoteExceedsLimitError,
    IdempotencyConflictError,
    InsufficientCreditsError,
    InsufficientScopeError,
    InvalidRequestError,
    OutcomeUnconfirmedError,
    ProductRequiresContextError,
    RateLimitedError,
    ResultUnavailableError,
    ServiceUnavailableError,
    TrendsFastError,
)

__all__ = [
    "PRODUCTS",
    "READ_CREDITS",
    "TrendsFast",
    "__version__",
    "normalize_base_url",
    "pick_filters",
    "key_prefix",
    "TrendsFastError",
    "AuthRequiredError",
    "InsufficientScopeError",
    "InsufficientCreditsError",
    "CreditQuoteExceedsLimitError",
    "IdempotencyConflictError",
    "ContextNotCurrentError",
    "ProductRequiresContextError",
    "ResultUnavailableError",
    "RateLimitedError",
    "OutcomeUnconfirmedError",
    "InvalidRequestError",
    "ConflictError",
    "ServiceUnavailableError",
]
