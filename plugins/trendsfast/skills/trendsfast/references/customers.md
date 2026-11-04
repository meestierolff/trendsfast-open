# Customers

Conversations where people like the brand's customers describe a problem, ask a question or
request something, collected fresh from Reddit, X, Hacker News and GitHub when the call runs.
Product `customers`, 10 credits.

## Run

`trendsfast_niche_trends` with these arguments:

```json
{"request_id": "<new uuid>", "max_credits": 10, "input": {"product": "customers", "context_id": "<context_id>"}}
```

Send no filters unless the user asks; the product applies its own lens. `lookback_hours`,
`platforms` and `limit` in `input` narrow it when they do.

## Read the result

- Each item: the post's title, community, observed time, measured signal (score, comments,
  likes), link, and the `problem` or `question` it states.
- `communities`: each community's rules on self-promotion, links and AI-written posts (with
  rule numbers), where promotion belongs, what wins there and a play. Read it before drafting
  anything for that community; silence in the rules is not permission.
- `brief`: what the items are good for, the coverage gaps and next steps. `coverage`: which
  sources were read and which were not.

**Done when:** each problem you report cites its source link and observed time, the coverage
gaps are stated, and any draft respects the community's rules.

Next: [trending.md](trending.md) for what is gaining attention, [content-plan.md](content-plan.md)
to turn both into a week of posts.
