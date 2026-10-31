# Search

What people search for around the brand's niche, and what AI assistants answer to the
category's buyer question: the brands they name, whether that includes the brand or its
competitors, and the sources they cite. It reads Google Trends, ChatGPT, Claude, Gemini and
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
  the other `names` in its order, and `cited_domains`. The question carried no brand; who is
  named was matched afterwards.
- `coverage`: which sources answered and which did not.

**Done when:** you state, per assistant, whether it named the brand and which competitors and
domains it cited, each search figure has its unit and period, and gaps are stated.

Next: [competitors.md](competitors.md) for what they post, [market-brief.md](market-brief.md)
for a one-page brief.
