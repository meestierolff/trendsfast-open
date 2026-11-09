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

## Answer the posts worth answering

The result lists the Reddit threads to answer first, best first: the first three as the
handout's `reply_first`. Each gives its `intent` (asks for a
tool, compares options, wants out of a tool, or describes the problem), its age and comments when
read, and `mention`: what a reply may do with the product under that community's rules.

- `NAME_AND_LINK`: answer in full first, then name the product once as one option, say it is
  yours, and link it.
- `NAME_ONLY`: the same, without the link.
- `NOT_IN_REPLY`: answer without the product.

Draft each reply for the person to post from their own account, one thread at a time. A reply
answers in its own words before anything else, and a post asking for no tool gets no pitch.
Never post for them, never use a second account and never ask for votes. Answer the newest
first: a thread over a week old is rarely read.

For the person's own posts: their true story with real numbers and its lesson, or an experiment
where the product is one ingredient; never an announcement. One community per story: the same
story in several communities within days gets removed. The questions in these threads are also
the pages worth writing, one question to a page, answered first.

**Done when:** each problem you report cites its source link and observed time, the coverage
gaps are stated, and any draft respects the community's rules.

Next: [trending.md](trending.md) for what is gaining attention, [content-plan.md](content-plan.md)
to turn both into a week of posts.
