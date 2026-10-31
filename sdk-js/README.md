# trendsfast

The TrendsFast SDK for Node.js: source-backed market evidence for AI agents and apps. Ask
what a brand's customers are stuck on, what is trending in its niche, what competitors post,
which videos work and what people search for and AI assistants answer. Every item comes back
with its source link, when it was observed and the measured signal.

Zero runtime dependencies. Node 20 or newer. MIT.

```bash
npm install trendsfast
```

## Quickstart

```ts
import { TrendsFast } from "trendsfast";

const tf = new TrendsFast(); // TRENDSFAST_API_KEY, or the key `trendsfast login` stored

const { context } = await tf.context(); // free: the brand products run on
const quote = await tf.quote("niche", "customers"); // free: 10 credits

const result = await tf.customers({ lookback_hours: 168, limit: 10 });
for (const item of result.data.version === "trend-intelligence-v3" ? result.data.items : [])
  console.log(item.current_observation.title, item.entity.original_url);
console.log(result.result_id, result.usage.credits_charged);
```

Get a key by signing in with the CLI (`npx -y trendsfast-cli@latest login`) or at
https://trendsfast.com/dashboard/api-keys. A verified account gets 100 free credits once.

## Methods

| Method | Credits | What it does |
| --- | --- | --- |
| `context()` | free | The brand's confirmed context and its `context_id` |
| `wallet()` | free | The credit balance |
| `quote(operation, product?)` | free | A call's price; a product is quoted as `quote("niche", "customers")` |
| `customers(options?)` | 10 | Conversations where people like the brand's customers describe a problem |
| `trending(options?)` | 25 | Posts, videos and searches gaining attention in the niche and next to it |
| `competitors(options?)` | 30 | The competitors' recent posts and how each performed |
| `formats(options?)` | 20 | Short videos that win attention, with their opening hooks |
| `search(options?)` | 35 | Search interest, and what AI assistants answer to the category's buyer question |
| `globalTrends(options?)` | 1 | What is trending across the whole index; no brand needed |
| `niche(description?, options?)` | 3 | The index ranked against a niche you describe, or the brand without one |
| `ask(question, options?)` | 5 | One bounded question answered from saved evidence |
| `discover(question?, options?)` | 5 | One question across every scope and channel |
| `result(id, cursor?)` | free | Reread or page a saved result |
| `recover(requestId)` | free | The outcome of a paid call by its request ID |
| `history(cursor?)` | free | Your saved results |

Options use the API's own names: `lookback_hours`, `observed_from`, `observed_to`,
`platforms`, `content_types`, `categories`, `signals`, `limit` and the rest of
`TrendIndexQueryV3`, plus `context_id`, `max_credits` and `request_id`. Products read the
brand's `context_id` for free when you do not pass one. `compactResult(result)` gives the same
small view TrendsFast's MCP server sends.

## Paid calls, safely

- Every paid call carries a `request_id` (made for you unless you pass one) and
  `max_credits` (the tariff unless you pass one). TrendsFast never charges more than the cap,
  and never twice for one request ID.
- Network errors, 5xx and 429 are retried up to three times with the **same** request ID,
  honouring `Retry-After`; other 4xx are never retried. If the answer is still lost, the SDK
  reads the request back once for free. If the outcome is still unknown it throws
  `OutcomeUnconfirmedError`; call `recover(error.requestId)` later. It never resends a paid
  call under a new ID.
- Errors are typed: `AuthRequiredError`, `InsufficientScopeError`, `InsufficientCreditsError`,
  `CreditQuoteExceedsLimitError`, `IdempotencyConflictError`, `ContextNotCurrentError`,
  `ProductRequiresContextError`, `ResultUnavailableError`, `RateLimitedError`,
  `OutcomeUnconfirmedError`, all extending `TrendsFastError` with `code`, `status`,
  `requestId` and `retryAfterSeconds`.

## Configuration

```ts
new TrendsFast({
  apiKey: process.env.TRENDSFAST_API_KEY, // default: env, then the CLI's stored key
  baseUrl: "https://trendsfast.com",       // https only (http for 127.0.0.1/localhost)
  maxRetries: 3,
  timeoutMs: 30_000,                       // free reads
  paidTimeoutMs: 150_000,                  // paid calls
});
```

The key is sent only to the configured origin, never logged, and redirects are not
followed. The User-Agent is `trendsfast-js/<version>`; nothing else is collected.

REST contract: https://trendsfast.com/v3/openapi.json. Docs: https://trendsfast.com/docs.
