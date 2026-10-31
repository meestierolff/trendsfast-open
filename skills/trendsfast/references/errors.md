# Errors

The CLI exits with one code per kind of failure. Over MCP and REST the same code arrives as
`error` in the response.

| Exit | Code | What to do |
| --- | --- | --- |
| 1 | `PRODUCT_REQUIRES_CONTEXT`, usage | No confirmed brand, or a wrong flag; nothing was charged. Read `trendsfast <command> --help`; for a typed niche use `trendsfast niche`. |
| 2 | `AUTH_REQUIRED`, `INSUFFICIENT_SCOPE` | Not signed in or the key is refused. Run `trendsfast whoami` once, report, stop. |
| 3 | `INSUFFICIENT_CREDITS`, `CREDIT_QUOTE_EXCEEDS_LIMIT` | Show the balance. Do not buy anything. |
| 4 | `IDEMPOTENCY_CONFLICT`, `CONTEXT_NOT_CURRENT`, `RESULT_UNAVAILABLE` | Reread the context; new input needs a new request ID; never rebuild an expired result from memory. |
| 5 | `RATE_LIMITED` | Wait `retry_after`, then run the same command again. Do not loop. |
| 6 | `REQUEST_OUTCOME_UNCONFIRMED` | It may have completed: run `trendsfast request <id>` later (MCP: `trendsfast_read_result` with the `request_id`), never the call under a new ID. |
| 7 | network or server | Try once more later; report if it persists. |

Exits 2 and 3 are terminal for the task: report the reason and stop. Never buy credits, start a
subscription or open checkout.
