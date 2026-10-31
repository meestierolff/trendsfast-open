# Trending

Posts, videos and searches gaining attention in the brand's niche, then in the niches next to
it, collected fresh from TikTok, YouTube, Instagram, Facebook, X, Reddit, Hacker News and Google
Trends when the call runs. Product `niche` (the API's name for Trending), 25 credits.

## Run

```bash
trendsfast quote trending                                 # free
trendsfast trending --max-credits 25 -o trending.json
```

Over MCP, `trendsfast_niche_trends` with these arguments (REST: `POST /v3/trends/niche`, see
[rest.md](rest.md)):

```json
{"request_id": "<new uuid>", "max_credits": 25, "input": {"product": "niche", "context_id": "<context_id>"}}
```

Only the whole index, without a brand? `trendsfast global --max-credits 1` is cheaper.

## Read the result

- Each item: title, platform, observed time, measured signal (views, likes, score, relative
  interest), link, and whether it is in the core niche or next door (`ring`).
- `topic_history`: EMERGING, RISING, PEAKING, DECLINING or EVERGREEN, since when and on how many
  channels. It is the only basis for saying a topic is rising; without it, say what was
  measured, not where it is heading.
- `communities`: the brand's communities' rules and play; read them before drafting a post.
- `brief` and `coverage`: what each item is good for, and what was not collected.

**Done when:** each trend you report has a source link, an observed time and a measured
signal, rising claims come from `topic_history`, and coverage gaps are stated.

Next: [formats.md](formats.md) for the videos that work, [content-plan.md](content-plan.md) for
a week of posts.
