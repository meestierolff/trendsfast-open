# Formats

Short videos around the brand's niche on TikTok, YouTube, Instagram and Facebook, with their
views, and likes, comments and shares wherever the platform reports them, plus the opening line
of the top TikTok and YouTube videos from their own transcripts. Product `formats`, 20 credits.

## Run

```bash
trendsfast quote formats                                  # free
trendsfast formats --max-credits 20 -o formats.json
```

Over MCP, `trendsfast_niche_trends` with these arguments (REST: `POST /v3/trends/niche`, see
[rest.md](rest.md)):

```json
{"request_id": "<new uuid>", "max_credits": 20, "input": {"product": "formats", "context_id": "<context_id>"}}
```

## Read the result

- Each video: title, creator, platform, observed time, views and engagement, link, its
  `format` and its `hook`, the opening line from the transcript.
- Describe the pattern the top videos share (format, hook, length) from these fields only. A
  brief for a new video may borrow the structure, never the creator's words or footage.
- `coverage`: which platforms were read; a platform missing was not observed.

**Done when:** each format you name cites at least one video link with its views and observed
time, hooks are quoted from the `hook` field, and coverage gaps are stated.

Next: [trending.md](trending.md) for the topics to make them about,
[content-plan.md](content-plan.md) for a week of posts.
