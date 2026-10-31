# trendsfast

The TrendsFast SDK for Python: source-backed market evidence for AI agents. Ask what a
brand's customers are stuck on, what is trending in its niche, what competitors post, which
videos work and what people search for and AI assistants answer, with every item's source
link, observed time and measured signal.

Standard library only. Python 3.9 or newer. MIT.

```bash
pip install trendsfast
```

## Quickstart

```python
from trendsfast import TrendsFast

tf = TrendsFast()  # TRENDSFAST_API_KEY, or the key `trendsfast login` stored
print(tf.context()["context"])            # free: the brand products run on
print(tf.quote("niche", "customers"))      # free: 10 credits
result = tf.customers(lookback_hours=168, limit=10)
for item in result["data"]["items"]:
    print(item["current_observation"]["title"], item["entity"]["original_url"])
print(result["result_id"], result["usage"]["credits_charged"])
```

Get a key by signing in with the CLI (`npx -y trendsfast-cli@latest login`) or at
https://trendsfast.com/dashboard/api-keys. A verified account gets 100 free credits once.

## Methods

`context()`, `wallet()`, `quote(operation, product=None)` and `history(cursor=None)` are free,
as are `result(id, cursor=None)` and `recover(request_id)`. The paid calls are
`customers()` (10 credits), `trending()` (25), `competitors()` (30), `formats()` (20),
`search()` (35), `global_trends()` (1), `niche(description)` (3), `ask(question)` (5) and
`discover(question=None)` (5).

Options are keyword arguments named as the API names them: `lookback_hours`,
`observed_from`, `observed_to`, `platforms`, `content_types`, `limit` and the other filters,
plus `context_id`, `max_credits` and `request_id`. An unknown option raises `TypeError`.
Products read the brand's `context_id` for free when you do not pass one; `ask` and
`discover` take `brand=True` to answer against it.

## Paid calls, safely

- Every paid call carries a `request_id` (made for you unless you pass one) and
  `max_credits` (the tariff unless you pass one). TrendsFast never charges more than the cap,
  and never twice for one request ID.
- Network errors, 5xx and 429 are retried up to three times with the **same** request ID,
  honouring `Retry-After`; other 4xx never are. A still-lost answer is read back once for free;
  if the outcome is unknown, `OutcomeUnconfirmedError` is raised and `recover(error.request_id)`
  reads it later. It never resends a paid call under a new ID.
- Errors are typed (`AuthRequiredError`, `InsufficientScopeError`, `InsufficientCreditsError`,
  `CreditQuoteExceedsLimitError`, `IdempotencyConflictError`, `ContextNotCurrentError`,
  `ProductRequiresContextError`, `ResultUnavailableError`, `RateLimitedError`,
  `OutcomeUnconfirmedError`), all subclasses of `TrendsFastError` with `code`, `status`,
  `request_id`, `retry_after_seconds` and `exit_code`.

## As an agent tool

Wrap one method as a tool. The docstring is what the model reads; the return value is small
on purpose. Register it with LangChain's `@tool`, CrewAI's `@tool` or your framework's
equivalent; nothing here depends on them.

```python
from trendsfast import TrendsFast, TrendsFastError

tf = TrendsFast()


def customer_problems(limit: int = 10) -> str:
    """What are my customers stuck on right now? Returns sourced conversations from Reddit,
    X, Hacker News and GitHub, one per line with its link. Costs 10 credits per call."""
    try:
        result = tf.customers(limit=limit, max_credits=10)
    except TrendsFastError as error:
        return "TrendsFast refused (%s): %s" % (error.code, error)
    lines = []
    for item in result["data"]["items"]:
        observation = item["current_observation"]
        problem = (observation.get("conversation") or {}).get("problem", {}).get("value")
        lines.append("- %s (%s) %s" % (problem or observation["title"], item["entity"]["platform"], item["entity"]["original_url"]))
    return "\n".join(lines) or "No conversations matched; an empty result costs 0 credits."
```

## Configuration

```python
TrendsFast(
    api_key=None,                       # default: TRENDSFAST_API_KEY, then the CLI's stored key
    base_url="https://trendsfast.com",  # https only (http for 127.0.0.1/localhost)
    max_retries=3,
    timeout=30.0,                       # free reads, seconds
    paid_timeout=150.0,                 # paid calls, seconds
)
```

The key is sent only to the configured origin, never logged or shown in `repr`, and
redirects are not followed. The User-Agent is `trendsfast-python/<version>`; nothing else is
collected.

REST contract: https://trendsfast.com/v3/openapi.json. Docs: https://trendsfast.com/docs.
