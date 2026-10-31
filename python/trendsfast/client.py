"""The TrendsFast V3 API, with the standard library only."""
import json
import os
import random
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Dict, Mapping, Optional

from ._version import __version__
from ._catalog import (
    API_KEY_ENV,
    BASE_URL_ENV,
    DEFAULT_BASE_URL,
    FILTER_KEYS,
    MAX_CREDITS_CEILING,
    OPERATIONS,
    PAID_TIMEOUT,
    PATHS,
    READ_CREDITS,
    READ_TIMEOUT,
    UUID_PATTERN,
    product as find_product,
)
from .credentials import credentials_path, read_stored_credentials
from .errors import (
    AuthRequiredError,
    ConflictError,
    InvalidRequestError,
    OutcomeUnconfirmedError,
    ProductRequiresContextError,
    ServiceUnavailableError,
    TrendsFastError,
    error_from_response,
)
from .types import ContextResponse, HistoryResponse, QuoteResponse, TrendsResult, WalletResponse

_UNCERTAIN_CODES = {"NO_RESPONSE", "INVALID_RESPONSE", "RESPONSE_IDENTITY_MISMATCH"}
_CALL_KEYS = {"request_id", "max_credits"}
_RING_KEYS = {"include_adjacent", "include_global"}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: it would carry the key to wherever it points."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        return None


def normalize_base_url(value: str) -> str:
    """An https origin, or http on the loopback host for local testing. Raises otherwise."""
    url = urllib.parse.urlsplit(value)
    loopback = url.hostname in ("127.0.0.1", "localhost")
    if url.scheme != "https" and not (url.scheme == "http" and loopback):
        raise InvalidRequestError(
            "INVALID_BASE_URL", "The TrendsFast base URL must use https (http only for 127.0.0.1 or localhost).", "usage"
        )
    if not url.netloc or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        raise InvalidRequestError("INVALID_BASE_URL", "The TrendsFast base URL is an origin only, such as https://trendsfast.com.", "usage")
    return "%s://%s" % (url.scheme, url.netloc)


def _retry_after(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        return max(0, int(float(value) + 0.999))
    except ValueError:
        pass
    try:
        return max(0, int(parsedate_to_datetime(value).timestamp() - time.time() + 0.999))
    except (TypeError, ValueError):
        return None


def _require_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str) or not UUID_PATTERN.match(value):
        raise InvalidRequestError("INVALID_INPUT", "%s must be a UUID." % label, "usage")
    return value


def _require_text(value: Any, label: str, low: int, high: int) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not low <= len(text) <= high:
        raise InvalidRequestError("INVALID_INPUT", "%s must be %d to %d characters." % (label, low, high), "usage")
    return text


def _is_result(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("version") == "trends-api-v3"
        and isinstance(value.get("result_id"), str)
        and isinstance(value.get("request_id"), str)
        and isinstance(value.get("data"), dict)
        and isinstance(value.get("usage"), dict)
    )


def pick_filters(options: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """The filters set in ``options``, or None when none is."""
    filters = {key: options[key] for key in FILTER_KEYS if options.get(key) is not None}
    return filters or None


def _check_options(options: Mapping[str, Any], allowed: set, method: str) -> None:
    unknown = set(options) - allowed
    if unknown:
        raise TypeError("%s() got unexpected options: %s" % (method, ", ".join(sorted(unknown))))


class TrendsFast:
    """The TrendsFast V3 API.

    Every paid call carries a request ID and ``max_credits``. A lost answer is retried with the
    same request ID, so it is never charged twice, then read back once for free; if the outcome
    is still unknown the call raises ``OutcomeUnconfirmedError`` and ``recover(request_id)``
    reads it later. It never sends a paid call again under a new ID.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        *,
        max_retries: int = 3,
        max_retry_delay: float = 30.0,
        timeout: float = READ_TIMEOUT,
        paid_timeout: float = PAID_TIMEOUT,
        user_agent: Optional[str] = None,
        env: Optional[Mapping[str, str]] = None,
        credentials_file: Optional[str] = None,
        use_stored_credentials: bool = True,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        environ = dict(os.environ if env is None else env)
        env_key = (environ.get(API_KEY_ENV) or "").strip()
        stored = None
        if not api_key and not env_key and use_stored_credentials:
            from pathlib import Path

            stored = read_stored_credentials(Path(credentials_file) if credentials_file else credentials_path(environ))
        if api_key:
            self._api_key: Optional[str] = api_key
            self.key_source = "option"
        elif env_key:
            self._api_key = env_key
            self.key_source = "env"
        elif stored:
            self._api_key = stored["api_key"]
            self.key_source = "stored"
        else:
            self._api_key = None
            self.key_source = "none"
        self.base_url = normalize_base_url(
            base_url or (environ.get(BASE_URL_ENV) or "").strip() or (stored or {}).get("base_url") or DEFAULT_BASE_URL
        )
        self._max_retries = max(0, min(int(max_retries), 10))
        self._max_retry_delay = float(max_retry_delay)
        self._timeout = float(timeout)
        self._paid_timeout = float(paid_timeout)
        self._user_agent = user_agent or "trendsfast-python/%s" % __version__
        self._sleep = sleep
        self._opener = urllib.request.build_opener(_NoRedirect)

    def __repr__(self) -> str:  # never shows the key
        return "TrendsFast(base_url=%r, key_source=%r)" % (self.base_url, self.key_source)

    @property
    def has_api_key(self) -> bool:
        return bool(self._api_key)

    # ---- Free reads -------------------------------------------------------------------------

    def context(self) -> ContextResponse:
        """The brand's confirmed context and its ``context_id``, or ``context: None``. Free."""
        return self._read(PATHS["context"])

    def wallet(self) -> WalletResponse:
        """The credit balance shared by the dashboard, REST and MCP. Free."""
        return self._read(PATHS["wallet"])

    def quote(self, operation: str, product: Optional[str] = None) -> QuoteResponse:
        """What a call costs before you make it. Free. A product is quoted with operation niche."""
        if operation not in OPERATIONS:
            raise InvalidRequestError("INVALID_INPUT", "Unknown operation: %s" % operation, "usage")
        query = {"operation": operation}
        if product is not None:
            if not find_product(product) or operation != "niche":
                raise InvalidRequestError("INVALID_INPUT", "A product is quoted with operation niche.", "usage")
            query["product"] = find_product(product)["id"]
        quote = self._read(PATHS["quote"], query)
        if not isinstance(quote, dict) or quote.get("operation") != operation:
            raise ServiceUnavailableError("RESPONSE_IDENTITY_MISMATCH", "The quote answered another operation.", "network")
        return quote

    def history(self, cursor: Optional[str] = None) -> HistoryResponse:
        """Your saved results, newest first, 50 per page. Free."""
        return self._read(PATHS["history"], {"cursor": cursor} if cursor else None)

    def result(self, id: str, cursor: Optional[str] = None) -> TrendsResult:
        """Reread a saved result, or its next page with ``next_cursor``. Free."""
        _require_uuid(id, "The result ID")
        result = self._read(PATHS["result"].replace("{id}", id), {"cursor": cursor} if cursor else None, result_id=id)
        if not _is_result(result) or result["result_id"] != id:
            raise ServiceUnavailableError("RESPONSE_IDENTITY_MISMATCH", "TrendsFast answered with another result.", "network")
        return result

    def recover(self, request_id: str) -> TrendsResult:
        """The outcome of a paid call, by the request ID it carried. Free; starts nothing."""
        _require_uuid(request_id, "The request ID")
        try:
            result = self._read(PATHS["request"].replace("{id}", request_id), request_id=request_id)
        except TrendsFastError as error:
            if error.status == 404 and error.code != "V3_DISABLED":
                raise InvalidRequestError(
                    "NOT_FOUND",
                    "TrendsFast has no record of request %s. If it was sent in the last minute, read it again; "
                    "otherwise it never started, and the same call can be sent again with this request ID." % request_id,
                    "usage",
                    status=404,
                    request_id=request_id,
                )
            raise
        if not _is_result(result) or result["request_id"] != request_id:
            raise ServiceUnavailableError("RESPONSE_IDENTITY_MISMATCH", "TrendsFast answered with another request.", "network")
        return result

    # ---- Products (paid; they collect the brand's own sources fresh) -------------------------

    def customers(self, **options: Any) -> TrendsResult:
        """Customers (10 credits): conversations where people like the brand's customers
        describe a problem, ask a question or request something."""
        return self.product("customers", **options)

    def trending(self, **options: Any) -> TrendsResult:
        """Trending (25 credits): what is gaining attention in the niche and next to it."""
        return self.product("niche", **options)

    def competitors(self, **options: Any) -> TrendsResult:
        """Competitors (30 credits): the competitors' recent posts and how each performed."""
        return self.product("competitors", **options)

    def formats(self, **options: Any) -> TrendsResult:
        """Formats (20 credits): short videos that win attention, with their opening lines."""
        return self.product("formats", **options)

    def search(self, **options: Any) -> TrendsResult:
        """Search (35 credits): search interest, and what AI assistants answer."""
        return self.product("search", **options)

    def product(self, id: str, **options: Any) -> TrendsResult:
        """Any product by its API id, on the brand's confirmed context."""
        _check_options(options, set(FILTER_KEYS) | _CALL_KEYS | _RING_KEYS | {"context_id"}, "product")
        entry = find_product(id)
        if not entry:
            raise InvalidRequestError("INVALID_INPUT", "Unknown product: %s" % id, "usage")
        payload: Dict[str, Any] = {"product": entry["id"], "context_id": self._brand_context_id(options.get("context_id"))}
        filters = pick_filters(options)
        if filters:
            payload["filters"] = filters
        payload.update({key: options[key] for key in _RING_KEYS if options.get(key) is not None})
        return self.query(
            "niche", payload, request_id=options.get("request_id"), max_credits=options.get("max_credits", entry["credits"])
        )

    # ---- Index reads (paid, cheaper; saved observations only) --------------------------------

    def global_trends(self, **options: Any) -> TrendsResult:
        """What is trending across the whole index (1 credit). No brand needed."""
        _check_options(options, set(FILTER_KEYS) | _CALL_KEYS, "global_trends")
        return self.query("global", pick_filters(options) or {}, request_id=options.get("request_id"), max_credits=options.get("max_credits"))

    def niche(self, description: Any = None, **options: Any) -> TrendsResult:
        """The index ranked against a niche you describe (3 credits): a string or a dict with
        ``description`` and lists such as ``keywords``. Without one it ranks against the
        brand's confirmed context. Collects nothing."""
        _check_options(options, set(FILTER_KEYS) | _CALL_KEYS | _RING_KEYS | {"context_id"}, "niche")
        if description is None:
            payload: Dict[str, Any] = {"context_id": self._brand_context_id(options.get("context_id"))}
        else:
            niche = {"description": description} if isinstance(description, str) else dict(description)
            niche["description"] = _require_text(niche.get("description"), "The niche description", 3, 2000)
            payload = {"niche": niche}
        filters = pick_filters(options)
        if filters:
            payload["filters"] = filters
        payload.update({key: options[key] for key in _RING_KEYS if options.get(key) is not None})
        return self.query("niche", payload, request_id=options.get("request_id"), max_credits=options.get("max_credits"))

    def ask(self, question: str, **options: Any) -> TrendsResult:
        """One bounded question answered from saved evidence (5 credits). Pass ``brand=True``
        to answer against the brand's confirmed context, or ``niche={...}``."""
        _check_options(options, set(FILTER_KEYS) | _CALL_KEYS | _RING_KEYS | {"context_id", "niche", "brand"}, "ask")
        payload: Dict[str, Any] = {"question": _require_text(question, "The question", 3, 1000)}
        payload.update(self._scope(options))
        return self.query("ask", payload, request_id=options.get("request_id"), max_credits=options.get("max_credits"))

    def discover(self, question: Optional[str] = None, **options: Any) -> TrendsResult:
        """One question across global, core and adjacent scope and every channel (5 credits)."""
        _check_options(
            options, set(FILTER_KEYS) | _CALL_KEYS | _RING_KEYS | {"context_id", "niche", "brand", "scope", "channels"}, "discover"
        )
        payload: Dict[str, Any] = {}
        if question is not None:
            payload["question"] = _require_text(question, "The question", 3, 1000)
        for key in ("scope", "channels"):
            if options.get(key) is not None:
                payload[key] = list(options[key])
        payload.update(self._scope(options))
        return self.query("discover", payload, request_id=options.get("request_id"), max_credits=options.get("max_credits"))

    def query(
        self, operation: str, input: Dict[str, Any], request_id: Optional[str] = None, max_credits: Optional[int] = None
    ) -> TrendsResult:
        """One paid call with its input exactly as given. ``max_credits`` defaults to the plain
        price of the operation, or a product's price when ``input["product"]`` is set."""
        if operation not in OPERATIONS:
            raise InvalidRequestError("INVALID_INPUT", "Unknown operation: %s" % operation, "usage")
        rid = _require_uuid(request_id or str(uuid.uuid4()), "The request ID")
        entry = find_product(input["product"]) if isinstance(input.get("product"), str) else None
        cap = max_credits if max_credits is not None else (entry["credits"] if entry else READ_CREDITS[operation])
        if not isinstance(cap, int) or isinstance(cap, bool) or not 0 <= cap <= MAX_CREDITS_CEILING:
            raise InvalidRequestError(
                "INVALID_INPUT", "max_credits must be a whole number from 0 to %d." % MAX_CREDITS_CEILING, "usage", request_id=rid
            )
        body = {"request_id": rid, "max_credits": cap, "input": input}

        def valid(value: Any) -> bool:
            return _is_result(value) and value["request_id"] == rid and value.get("operation") == operation

        try:
            return self._send("POST", PATHS[operation], body=body, timeout=self._paid_timeout, request_id=rid, valid=valid)
        except TrendsFastError as error:
            uncertain = error.status == 0 or error.status >= 500 or error.code in _UNCERTAIN_CODES
            if not uncertain or error.status == 429:
                raise
            return self._recover_once(rid, operation, error)

    # ---- Internals ---------------------------------------------------------------------------

    def _recover_once(self, request_id: str, operation: str, cause: TrendsFastError) -> TrendsResult:
        nxt = (
            'Read it with recover("%s") or `trendsfast request %s` before sending anything new; '
            "never send it again under a new request ID." % (request_id, request_id)
        )
        try:
            return self._send(
                "GET",
                PATHS["request"].replace("{id}", request_id),
                timeout=self._timeout,
                request_id=request_id,
                retries=0,
                valid=lambda value: _is_result(value) and value["request_id"] == request_id and value.get("operation") == operation,
            )
        except TrendsFastError as error:
            if error.code == "REQUEST_RELEASED":
                raise ConflictError(
                    "REQUEST_RELEASED",
                    "The call with request ID %s ended without a result or a charge. Send it again with a new request ID." % request_id,
                    "conflict",
                    status=error.status,
                    request_id=request_id,
                )
            if error.kind == "conflict" and error.status == 410:
                raise
            code = error.code if error.code in ("REQUEST_IN_PROGRESS", "EFFECT_UNKNOWN") else "REQUEST_OUTCOME_UNCONFIRMED"
            if error.status == 404:
                why = (
                    "TrendsFast has no record of request %s yet. If a later read still finds none, it never started, "
                    "and the same call can be sent again with this request ID." % request_id
                )
            elif error.code == "REQUEST_IN_PROGRESS":
                why = "The call with request ID %s is still running." % request_id
            else:
                why = "TrendsFast could not confirm the outcome of request %s; it may have run." % request_id
            raise OutcomeUnconfirmedError(
                code, "%s %s" % (why, nxt), "unconfirmed", status=error.status or cause.status, request_id=request_id, recovery=nxt
            )

    def _brand_context_id(self, given: Optional[str] = None) -> str:
        if given:
            return _require_uuid(given, "The context ID")
        context = self.context().get("context")
        if not context or context.get("kind") != "CONFIRMED_CONTEXT" or not context.get("context_id"):
            raise ProductRequiresContextError(
                "PRODUCT_REQUIRES_CONTEXT",
                "This project has no confirmed brand context yet. Confirm your brand at https://trendsfast.com/dashboard, "
                "or read a niche you describe without a product.",
                "usage",
            )
        return context["context_id"]

    def _scope(self, options: Mapping[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if options.get("context_id"):
            payload["context_id"] = _require_uuid(options["context_id"], "The context ID")
        elif options.get("niche"):
            niche = dict(options["niche"])
            niche["description"] = _require_text(niche.get("description"), "The niche description", 3, 2000)
            payload["niche"] = niche
        elif options.get("brand"):
            payload["context_id"] = self._brand_context_id()
        filters = pick_filters(options)
        if filters:
            payload["filters"] = filters
        payload.update({key: options[key] for key in _RING_KEYS if options.get(key) is not None})
        return payload

    def _read(self, path: str, query: Optional[Mapping[str, str]] = None, request_id: Optional[str] = None, result_id: Optional[str] = None) -> Any:
        try:
            return self._send("GET", path, query=query, timeout=self._timeout, request_id=request_id, result_id=result_id)
        except TrendsFastError as error:
            # A free read changes nothing: an answer that did not arrive is a service failure,
            # not an unknown outcome; only a request still running stays unconfirmed.
            if error.kind == "unconfirmed" and error.code not in ("REQUEST_IN_PROGRESS", "EFFECT_UNKNOWN"):
                raise ServiceUnavailableError(
                    error.code,
                    "TrendsFast is not available right now (HTTP %d). This read is free; run it again later." % error.status
                    if error.status
                    else "No answer arrived from TrendsFast. This read is free; run it again later.",
                    "network",
                    status=error.status,
                    request_id=request_id,
                    result_id=result_id,
                )
            raise

    def _send(
        self,
        method: str,
        path: str,
        *,
        timeout: float,
        query: Optional[Mapping[str, str]] = None,
        body: Any = None,
        request_id: Optional[str] = None,
        result_id: Optional[str] = None,
        retries: Optional[int] = None,
        valid: Optional[Callable[[Any], bool]] = None,
    ) -> Any:
        if not self._api_key:
            raise AuthRequiredError(
                "AUTH_REQUIRED",
                "No TrendsFast API key: run `trendsfast login`, or set TRENDSFAST_API_KEY to a key from "
                "https://trendsfast.com/dashboard/api-keys.",
                "auth",
            )
        url = self.base_url + path + ("?" + urllib.parse.urlencode(query) if query else "")
        headers = {"Authorization": "Bearer %s" % self._api_key, "Accept": "application/json", "User-Agent": self._user_agent}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        attempts = self._max_retries if retries is None else retries
        last: Optional[TrendsFastError] = None
        attempt = 0
        while True:
            wait: Optional[float] = None
            try:
                request = urllib.request.Request(url, data=data, method=method, headers=headers)
                with self._opener.open(request, timeout=timeout) as response:
                    status = response.status
                    text = response.read().decode("utf-8", "replace")
                try:
                    parsed = json.loads(text)
                    if valid is None or valid(parsed):
                        return parsed
                    code = "RESPONSE_IDENTITY_MISMATCH"
                except ValueError:
                    code = "INVALID_RESPONSE"
                last = OutcomeUnconfirmedError(code, "TrendsFast's answer could not be read.", "unconfirmed", status=status, request_id=request_id, result_id=result_id)
            except urllib.error.HTTPError as error:
                status = error.code
                raw = error.read().decode("utf-8", "replace") if error.fp else ""
                try:
                    parsed_error: Any = json.loads(raw) if raw else None
                except ValueError:
                    parsed_error = None
                if 300 <= status < 400:
                    raise ServiceUnavailableError(
                        "REDIRECT_NOT_FOLLOWED",
                        "TrendsFast answered with a redirect (HTTP %d), which this client does not follow. Check the base URL." % status,
                        "network",
                        status=status,
                        request_id=request_id,
                        result_id=result_id,
                    )
                retry_after = _retry_after(error.headers.get("Retry-After") if error.headers else None)
                failure = error_from_response(status, parsed_error, request_id=request_id, retry_after_seconds=retry_after)
                if status != 429 and status < 500:
                    raise failure
                last = failure
                if retry_after is not None:
                    wait = float(retry_after)
            except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as error:
                detail = " (timed out)" if isinstance(error, socket.timeout) or "timed out" in str(error) else ""
                last = OutcomeUnconfirmedError(
                    "NO_RESPONSE", "No answer arrived from TrendsFast%s. The call may have run." % detail, "unconfirmed", request_id=request_id, result_id=result_id
                )
            if attempt >= attempts:
                break
            delay = wait if wait is not None else min(0.5 * 2**attempt, 8.0) + random.random() * 0.25
            if delay > self._max_retry_delay:
                break
            self._sleep(delay)
            attempt += 1
        assert last is not None
        raise last
