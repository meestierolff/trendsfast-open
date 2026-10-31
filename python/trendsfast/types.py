"""The shapes TrendsFast's V3 REST API returns, written from
https://trendsfast.com/v3/openapi.json. Fields an agent rarely reads are typed loosely."""
from typing import Any, Dict, List, Optional, TypedDict


class NicheContextField(TypedDict):
    field: str
    value: str
    basis: str
    evidence_ids: List[str]


class NicheContext(TypedDict):
    kind: str
    context_id: Optional[str]
    revision: Optional[int]
    fields: List[NicheContextField]


class ContextResponse(TypedDict):
    version: str
    context: Optional[NicheContext]


class WalletResponse(TypedDict):
    version: str
    accountId: str
    available: int
    free: int
    monthly: int
    prepaid: int
    reserved: int
    consumed: int
    debt: int
    paused: bool
    lots: List[Dict[str, Any]]


class QuoteResponse(TypedDict):
    version: str
    operation: str
    credits: int
    max_credits: int
    catalog_version: str
    new_research: bool
    available: bool


class HistoryEntry(TypedDict, total=False):
    result_id: str
    request_id: str
    operation: str
    product: str
    created_at: str
    state: str
    charged_credits: int


class HistoryResponse(TypedDict):
    version: str
    results: List[HistoryEntry]
    next_cursor: Optional[str]


class Usage(TypedDict):
    credits_charged: int
    read_charge: int
    this_request_credits: int
    catalog_version: str
    replayed: bool


class TrendsResult(TypedDict):
    """One saved result: what every paid call, reread and recovery returns. ``data`` is the
    intelligence (items, coverage, brief, communities, ai_answers) or, for Ask, an answer
    wrapping it."""

    version: str
    result_id: str
    request_id: str
    operation: str
    generated_at: str
    read_at: str
    new_research: bool
    data: Dict[str, Any]
    usage: Usage
    next_cursor: Optional[str]


class TemporaryNiche(TypedDict, total=False):
    description: str
    url: str
    topics: List[str]
    problems: List[str]
    audiences: List[str]
    exclusions: List[str]
    capabilities: List[str]
    jobs: List[str]
    industry: List[str]
    product_categories: List[str]
    customer_interests: List[str]
    competitors: List[str]
    adjacent_categories: List[str]
    market: str
    language: str
    platforms: List[str]
    communities: List[str]
    competitor_handles: List[str]
    competitor_domains: List[str]
    keywords: List[str]
