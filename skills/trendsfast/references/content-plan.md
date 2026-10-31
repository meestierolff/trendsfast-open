# Weekly content plan

Seven days of posts, each starting from evidence: a problem customers stated, a topic measured
as gaining attention, and a format that works. It costs 55 credits: Customers 10, Trending 25,
Formats 20. It drafts; the user reviews and posts. It never posts, schedules or messages anyone.

## 1. Infer first

Read `trendsfast context` (free) for the brand, its audience and its communities. Ask at most
one to three short questions, only if blocked: which channels to plan for (default: the brand's
communities, X and short video), and whether drafts are wanted or only the plan.

## 2. Check the budget

`trendsfast credits` (free). Tell the user the plan costs 55 credits and run it on their go
ahead. With less, drop Formats first (35 credits) and say so.

## 3. Collect, once each

```bash
trendsfast customers --max-credits 10 -o plan-customers.json
trendsfast trending  --max-credits 25 -o plan-trending.json
trendsfast formats   --max-credits 20 -o plan-formats.json
```

They can run in parallel, each with its own request ID. On exit 6 run `trendsfast request <id>`
and keep going with what you have. Over MCP, the same three are `trendsfast_niche_trends` with
`product` `customers`, `niche` and `formats`.

## 4. Build the plan

For each day pick one item and fill one row:

| Day | Channel or community | Angle (from which item) | Format and hook pattern | Rules check | Source |
| --- | --- | --- | --- | --- | --- |

- **Angle:** a Customers problem or question, or a Trending topic. Say "rising" only when the
  item's `topic_history` says so.
- **Format:** a pattern from Formats; quote the hook it is modelled on, never a creator's words.
- **Rules check:** that community's rules from the Customers or Trending result: self-promotion,
  links and AI-written posts, with rule numbers, and where promotion belongs. Silence is not
  permission; when a rule forbids what the post needs, move it to a channel that allows it or
  drop it.
- **Source:** the item's link and observed date.

Then list what was not covered (from each result's coverage) and three unused items worth
watching.

## 5. Deliver

1. The seven-row table.
2. Drafts, if asked, one per row, each within its community's rules, marked for review.
3. Coverage gaps and the request or result IDs the plan came from; `trendsfast result <id>`
   rereads them for free.

**Done when:** every row cites a source link and a rules check, the total spent is stated, and
nothing was posted.

To rerun it weekly, keep these inputs:

```yaml
workflow: trendsfast/content-plan
cadence: weekly
inputs: {channels: [communities, x, short-video], drafts: true, max_credits: 55}
```
