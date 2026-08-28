---
name: trendsfast
description: Use TrendsFast Remote MCP to inspect project-scoped research and present one evidence-bound Content Play, creating a billable scan only after explicit founder confirmation.
metadata:
  version: "1.0.0"
---

# TrendsFast

Use TrendsFast as a research and Content Play system with a strict read-before-create workflow. A scan can be billable, and its output always remains subject to human review.

## Connection and project scope

Verify that TrendsFast is connected and exposes exactly these seven tools before doing any work:

- `trendsfast_project_context_get` — establish the connected project context.
- `trendsfast_today_create` — start the one explicitly confirmed scan.
- `trendsfast_today_status_get` — poll that scan without creating another.
- `trendsfast_brief_latest_get` — inspect the latest available brief.
- `trendsfast_brief_get` — retrieve an immutable brief by its returned identifier.
- `trendsfast_creative_handoff_get` — retrieve the handoff for a video play.
- `trendsfast_sources_get` — retrieve the returned evidence sources.

If the connection or tool set is invalid, stop and explain the connection problem. Never attempt a create while disconnected.

Call `trendsfast_project_context_get` first. Work only in the project context bound to the current connection, and use only resource identifiers returned for that context. Never call a tool from another project context, and never use a resource identifier returned for one. Stop on any context mismatch.

Never expose the API key in a prompt, tool argument, command, log, error, summary, or output.

## Read before creating

Call `trendsfast_brief_latest_get` before considering a new scan. When a latest brief exists, retrieve it with `trendsfast_brief_get` and retrieve its supporting sources with `trendsfast_sources_get`. Explain to the founder whether it is sufficient for the current objective, considering its stated freshness, evidence, and limitations.

If the existing brief is sufficient, present it and stop. Never create automatically, and never create merely because the verdict is `NO_CLEAR_TREND`.

## Creation gate

Only when the existing brief is insufficient:

1. Explain why a new scan is needed and ask the founder immediately before starting the new billable scan.
2. Continue only after explicit confirmation. Silence or an ambiguous response is not confirmation.
3. Generate exactly one UUID v4 client-side and use it as the visible idempotency key.
4. Call `trendsfast_today_create` exactly once. Do not issue a second create call after a timeout, uncertain response, error, or status delay.
5. Use the returned scan identifier to poll only through `trendsfast_today_status_get`. Wait at least the retry timing returned by each response before the next poll; do not substitute a shorter interval.
6. Stop polling at `REVIEW_REQUIRED` or `READY`. If the run fails, report the failure and stop without creating another scan.
7. Read `trendsfast_brief_latest_get`, verify that the returned brief belongs to the completed scan and current context, then use its returned brief identifier with `trendsfast_brief_get`. Retrieve the supporting source projection with `trendsfast_sources_get`.

## Interpret the result honestly

Treat the returned Trend Verdict as a finding, not a target:

- `CLEAR_TREND` means the returned evidence supports a timely trend claim within the returned limitations. It does not guarantee virality or any outcome.
- `NO_CLEAR_TREND` is a valid, honest result. Do not relabel it, rerun to force a different verdict, or describe an evergreen fallback as a trend. If the result supplies an evergreen Content Play, label it as evergreen and preserve its returned basis.

Preserve the meaning and provenance of all returned evidence and limitations. Do not omit limitations, strengthen claims, invent corroboration, or blur evidence with inference.

## Present one Content Play

Present exactly one complete Content Play from the returned brief. Include:

- scan ID and brief ID;
- lifecycle and honest Trend Verdict;
- platform and destination when applicable;
- format;
- hook;
- complete content or script;
- caption when applicable;
- CTA;
- evidence; and
- limitations.

When the Content Play is video, retrieve and present its creative handoff with `trendsfast_creative_handoff_get`. When it is not video, do not invent a handoff.

Never copy a named creator's expression. Extracting a general pattern does not permit reproducing distinctive wording, structure, or creative execution.

## Human-action boundary

Never approve, deliver, publish, or schedule. Present the Content Play for human review only, even when its lifecycle is `READY`. Never claim guaranteed virality.
