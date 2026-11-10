# Search

What people search for around the brand's niche, and what AI assistants answer, searching the
web, to the question a buyer in the brand's category would ask: the brands they name, whether
that includes the brand or its competitors, and the sources they cite. It reads Google Trends, ChatGPT, Claude, Gemini and
Perplexity. Product `search`, 35 credits; the price covers four live AI answers.

## Run

```bash
trendsfast quote search                                   # free
trendsfast search --max-credits 35 -o search.json
```

Over MCP, `trendsfast_niche_trends` with these arguments (REST: `POST /v3/trends/niche`, see
[rest.md](rest.md)):

```json
{"request_id": "<new uuid>", "max_credits": 35, "input": {"product": "search", "context_id": "<context_id>"}}
```

## Read the result

- Search items: the query, its relative interest (0-100) or modeled monthly demand, and the
  observed period. A relative index is not a volume; say which one it is.
- `ai_answers`: per assistant, `mentions_you` (whether it names the brand), `competitors_named`,
  the other `names` in its order, and `cited_domains`. The question is built from the brand's
  confirmed category and audience and never names the brand; who is named was matched
  afterwards.
- `coverage`: which sources answered and which did not.

## Get mentioned where the assistants read

An assistant recommends what the pages it reads mention. The pages the answers cite are
`cited_pages` in the full result, best first, and the first three a brand can act on are the
handout's `get_mentioned`. All four assistants search the web, so each can cite what it read.
Each page has its `kind` and its `move`:

- `ANSWER_THE_THREAD`, a Reddit or forum thread: read the community's rules first and draft a
  reply that answers in its own words before any product, as [customers.md](customers.md) says.
- `ASK_TO_BE_LISTED`, a list or comparison: draft a short note asking its author to consider the
  brand, with one concrete reason. The person sends it.
- `GET_REVIEWED`, a review or listing site: list the product there and ask real users for honest
  reviews. Never write one.

Run Search again after a month to see whether the answers changed. Never promise that an
assistant will name the brand.

**Done when:** you state, per assistant, whether it named the brand and which competitors and
domains it cited, each search figure has its unit and period, each cited page to act on has its
move, and gaps are stated.

Next: [competitors.md](competitors.md) for what they post, [market-brief.md](market-brief.md)
for a one-page brief.
