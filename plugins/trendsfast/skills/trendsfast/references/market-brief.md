# One-page market brief

One page that answers one decision with sourced evidence. The full brief costs 75 credits:
Customers 10, Competitors 30, Search 35. It stays within the budget the user states and says
what it left out.

## 1. Infer the decision

Read `trendsfast_project_context` (free) and the conversation. Name the decision in one sentence (for
example: "launch the invoicing add-on to freelance designers this month?"). Ask at most one to
three short questions, only if blocked, and always ask for the credit budget if none was given.

## 2. Fit the budget

`trendsfast_credit_balance` (free). Choose the calls that fit, in this order, and say which and why:

| Budget | Calls |
| --- | --- |
| 75 or more | Customers, Competitors, Search |
| 40 to 74 | Customers and Competitors (40) or Customers and Search (45), whichever the decision needs |
| 10 to 39 | Customers; add `trendsfast_ask_trends` with the decision (5) if it fits |
| under 10 | `trendsfast_ask_trends` with the decision (5) or `trendsfast_niche_trends` without a product (3) |

Never go over the budget, and never buy credits.

## 3. Collect, once each

`trendsfast_niche_trends` calls, with `product` `customers`, `competitors` and `search`. They can
run in parallel, each with its own request ID. On `REQUEST_OUTCOME_UNCONFIRMED` read it back with
`trendsfast_read_result`; never re-run under a new ID.

## 4. Write the page

```markdown
# <Decision, as a question>

**Answer:** <yes / no / not yet>, because <one sentence>. Confidence: <high / medium / low>, because <coverage>.

## What customers say
- <problem or request> — <source link>, <observed date>, <signal>

## What competitors do
- <account>: <post and how it performed> — <link>, <date>

## What people search, and what AI assistants answer
- <query>: <relative interest or modeled demand, with unit and period>
- <assistant>: names you: <yes/no>; competitors named: <…>; cites: <domains>

## Gaps
- <channels or questions the evidence did not cover>

## Next step
- <one action>

Spent: <n> credits. Results: <result IDs> (rereads are free).
```

Tie every claim to an item; when the evidence does not answer part of the decision, say so in
Gaps rather than filling it in.

**Done when:** the page fits on one screen, every bullet cites a source link, the gaps and the
credits spent are stated, and the answer follows from the evidence shown.

To rerun it, keep these inputs:

```yaml
workflow: trendsfast/market-brief
cadence: on-demand
inputs: {decision: "<one sentence>", max_credits: 75}
```
