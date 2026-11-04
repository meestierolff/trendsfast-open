# Errors

A failed call names its code as `error` in the response.

| Code | What to do |
| --- | --- |
| `PRODUCT_REQUIRES_CONTEXT` | No confirmed brand, or a wrong argument; nothing was charged. Check the arguments against the tool's schema; a typed niche names no product. |
| `AUTH_REQUIRED`, `INSUFFICIENT_SCOPE` | Not signed in, or the connection was refused. Ask the user to connect this app again, report, stop. |
| `INSUFFICIENT_CREDITS`, `CREDIT_QUOTE_EXCEEDS_LIMIT` | Show the balance. Do not buy anything. |
| `IDEMPOTENCY_CONFLICT`, `CONTEXT_NOT_CURRENT`, `RESULT_UNAVAILABLE` | Reread the context; new input needs a new request ID; never rebuild an expired result from memory. |
| `RATE_LIMITED` | Wait `retry_after`, then make the same call again. Do not loop. |
| `REQUEST_OUTCOME_UNCONFIRMED` | It may have completed: call `trendsfast_read_result` with the `request_id` later, never the call under a new ID. |
| Network or server failure | Try once more later; report if it persists. |

`AUTH_REQUIRED`, `INSUFFICIENT_SCOPE`, `INSUFFICIENT_CREDITS` and `CREDIT_QUOTE_EXCEEDS_LIMIT`
end the task: report the reason and stop. Never buy credits, start a
subscription or open checkout.
