# Competitors

Recent posts from the competitors' own X, TikTok, Instagram and YouTube accounts, read when the
call runs, with how each one performed. The competitors and their accounts come from the
brand's confirmed context. Product `competitors`, 30 credits.

## Run

First check that `trendsfast_project_context` (free) names the competitors and their handles. If it
names none, tell the user to add them at https://trendsfast.com/dashboard; the call would have
little to read.

`trendsfast_niche_trends` with these arguments:

```json
{"request_id": "<new uuid>", "max_credits": 30, "input": {"product": "competitors", "context_id": "<context_id>"}}
```

## Read the result

- The posts are in the brief's `COMPETITOR_ACTIVITY` section; each item has the account,
  platform, observed time, measured signal (views, likes, comments, reposts) and link.
- `performance.outlier` scores each post against the median views of that account's posts in
  the read: `score` (5.7 = 5.7× its usual), `label` (MEGA_VIRAL, VIRAL, ABOVE_AVERAGE,
  AVERAGE), `breakout` (over 3×), and the baseline's `posts` and `median_views`.
  Lead with the breakouts. A post under 48 hours old is still collecting views.
- Where the platform sent the account's follower count: each post's `performance.virality`, its
  Virality Score and tier.
- Compare what lands with what does not by these scores and the measured signal only. Say
  which account posted it; never guess at reach a post did not report.
- `coverage`: which platforms were read for which accounts, and which were not.

**Done when:** each competitor move you report links the post, names the account, gives the
measured signal, its outlier score with the baseline's size, and the observed time, and the
platforms not covered are stated.

Next: [search.md](search.md) for whether AI assistants name the competitors,
[market-brief.md](market-brief.md) for a one-page brief.
