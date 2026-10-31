"""What TrendsFast sells, where each call lives and what it costs.

Loaded from ``catalog.json`` beside this file, which the private product repository checks
against the server's own tariffs, schemas and OpenAPI document. The free quote
(``GET /v3/trends/quote``) is the authority at run time, and TrendsFast never charges more than
the ``max_credits`` a call carries.
"""
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

CATALOG: Dict[str, Any] = json.loads((Path(__file__).parent / "catalog.json").read_text(encoding="utf-8"))

DEFAULT_BASE_URL: str = CATALOG["default_base_url"]
MAX_CREDITS_CEILING: int = CATALOG["max_credits_ceiling"]
PAID_TIMEOUT: float = float(CATALOG["paid_timeout_seconds"])
READ_TIMEOUT: float = float(CATALOG["read_timeout_seconds"])
OPERATIONS: List[str] = CATALOG["operations"]
PRODUCTS: List[Dict[str, Any]] = CATALOG["products"]
READ_CREDITS: Dict[str, int] = CATALOG["read_credits"]
PATHS: Dict[str, str] = CATALOG["paths"]
FILTER_KEYS = (
    "platforms",
    "content_types",
    "categories",
    "signals",
    "evidence_quality",
    "country",
    "region",
    "observed_market",
    "language",
    "observed_from",
    "observed_to",
    "lookback_hours",
    "history_days",
    "compare_to",
    "limit",
)

API_KEY_ENV = "TRENDSFAST_API_KEY"
BASE_URL_ENV = "TRENDSFAST_BASE_URL"
API_KEY_PATTERN = re.compile(r"^tf_(?:test|live)_[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{32,128}$")
UUID_PATTERN = re.compile(
    r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
    r"|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
)


def product(id_or_command: str) -> Optional[Dict[str, Any]]:
    """A product by its API id (``niche``) or its command (``trending``)."""
    for entry in PRODUCTS:
        if id_or_command in (entry["id"], entry["command"]):
            return entry
    return None
