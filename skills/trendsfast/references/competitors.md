# Competitors

Recent posts from the competitors' own X, TikTok, Instagram and YouTube accounts, read when the
call runs, with how each one performed. The competitors and their accounts come from the
brand's confirmed context. Product `competitors`, 30 credits.

## Run

First check that `trendsfast context` (free) names the competitors and their handles. If it
names none, tell the user to add them at https://trendsfast.com/dashboard; the call would have
little to read.

```bash
trendsfast quote competitors                              # free
trendsfast competitors --max-credits 30 -o competitors.json
```

Over MCP, `trendsfast_niche_trends` with these arguments (REST: `POST /v3/trends/niche`, see
[rest.md](rest.md)):

```json
{"request_id": "<new uuid>", "max_credits": 30, "input": {"product": "competitors", "context_id": "<context_id>"}}
```

## Read the result

- The posts are in the brief's `COMPETITOR_ACTIVITY` section; each item has the account,
  platform, observed time, measured signal (views, likes, comments, reposts) and link.
- Compare what lands with what does not by the measured signal only. Say which account posted
  it; never guess at reach a post did not report.
- `coverage`: which platforms were read for which accounts, and which were not.

**Done when:** each competitor move you report links the post, names the account, gives the
measured signal and the observed time, and the platforms not covered are stated.

Next: [search.md](search.md) for whether AI assistants name the competitors,
[market-brief.md](market-brief.md) for a one-page brief.
