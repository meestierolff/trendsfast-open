# Formats

Short videos and TikTok slideshows around the brand's niche on TikTok, YouTube, Instagram and
Facebook, with their views, and likes, comments and shares wherever the platform reports them,
plus the opening line of the top TikTok and YouTube videos from their own transcripts. Product
`formats`, 20 credits.

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
  `format` and its `hook`, the opening line from the transcript. `format` is the platform's own
  label: SLIDESHOW (a TikTok photo carousel), SHORT (a TikTok video, YouTube Short or Reel) or
  LONG_FORM (a regular YouTube video); no frame was inspected to say so.
- `formats`, in the full result (`-o`, or the saved result over REST, see [rest.md](rest.md)): per
  format, its videos, the `accounts` that post it, `strong_hit_rate` and `lift` against the
  result's videos as a whole, smoothed toward 1 (null below 5 scored videos from 3 accounts, or
  5 scored videos of other formats to compare with). A high rate from
  few accounts is a format the niche under-uses; say how many scored videos and accounts it
  rests on. The compact view carries each item's `format`, so it can be tallied there.
- `performance`: each video's band against its platform's benchmark, its engagement rate and,
  where the follower count came with it, its Virality Score; rank by the score where there is
  one, never by raw views across platforms.
- `hook_type`: each hook's type (QUESTION, STATISTIC, NEGATION, TUTORIAL_PROMISE…), labelled by
  Claude (`hook-model-v1`) or by a stated rule (`hook-rules-v1`, which names the rule);
  `hook_types`: which types win, ranked by `strong_hit_rate` (the share
  of videos with a Virality Score of 18 or more). Recommend hook types by that rate, never by an
  average, and say how many scored videos it rests on.
- Describe the pattern the top videos share (format, hook, length) from these fields only. A
  brief for a new video may borrow the structure, never the creator's words or footage. For a
  slideshow or video tool, brief: the format, a hook in the brand's own words of the winning
  hook type, the length, and two or three reference links with their views.
- `coverage`: which platforms were read; a platform missing was not observed.

**Done when:** each format you name cites at least one video link with its views and observed
time, hooks are quoted from the `hook` field, and coverage gaps are stated.

Next: [trending.md](trending.md) for the topics to make them about,
[content-plan.md](content-plan.md) for a week of posts.
