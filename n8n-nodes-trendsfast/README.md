# n8n-nodes-trendsfast

This is an n8n community node. It lets you use [TrendsFast](https://trendsfast.com) in your n8n workflows and as a tool for n8n AI agents.

TrendsFast is a trends API for agents and applications. For a brand it finds where the customers talk and what they are stuck on, what is trending in the niche and next to it, what competitors post, which video formats work, and what people search for and AI assistants answer. Every item comes with its source, date and limits.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

> **Status: on npm, not yet verified by n8n.** Self-hosted n8n installs it as a community node. The nodes panel and n8n Cloud offer it only once n8n verifies it. See [Publishing](#publishing-maintainers).

[Installation](#installation) · [Credentials](#credentials) · [Operations and costs](#operations-and-costs) · [The request ID rule](#the-request-id-rule) · [AI agents](#use-it-as-an-ai-agent-tool) · [Output](#output) · [Examples](#example-workflows) · [Compatibility](#compatibility) · [Development](#development) · [Publishing](#publishing-maintainers) · [Standards](#standards-this-package-follows) · [Resources](#resources)

## Installation

**From the n8n UI (self-hosted; owners and admins).** Go to **Settings > Community Nodes > Install**, enter `n8n-nodes-trendsfast` (optionally with a version such as `@0.1.1`), confirm that you understand the risks of installing unverified code, and select **Install**. ([n8n: GUI installation](https://docs.n8n.io/integrations/community-nodes/installation/gui-install/))

**Manually (queue mode or private registries).** In the n8n container:

```sh
docker exec -it n8n sh
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm i n8n-nodes-trendsfast
```

Then restart n8n. ([n8n: manual installation](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/))

**As a verified node (only after n8n verifies it).** Search for TrendsFast in the nodes panel; it appears under **More from the community**. Owners and admins install it for the whole instance, on self-hosted n8n and on n8n Cloud. ([n8n: verified nodes](https://docs.n8n.io/integrations/community-nodes/installation/verified-install/))

Community nodes must be enabled: `N8N_COMMUNITY_PACKAGES_ENABLED` (default `true`), and `N8N_UNVERIFIED_PACKAGES_ENABLED` (default `true`) to install a node before n8n verifies it. ([n8n: node environment variables](https://docs.n8n.io/hosting/configuration/environment-variables/nodes/))

## Credentials

The node uses one credential type, **TrendsFast API**: a project API key sent as `Authorization: Bearer <key>`.

1. In TrendsFast, open **API keys** in your dashboard ([trendsfast.com/dashboard/api-keys](https://trendsfast.com/dashboard/api-keys)) and create a project key. It looks like `tf_live_<prefix>.<secret>` and is shown once.
2. Choose its scopes:
   - `trends:query` to run products, global trends queries and questions (paid);
   - `trends:read` to read results, requests and your brand context (free);
   - `credits:read` to read quotes, your wallet and your history (free). **The credential test needs it.**
3. In n8n, create a **TrendsFast API** credential and paste the key into **API Key**. n8n tests it with `GET /v3/trends/wallet`, which is free.

n8n stores the key encrypted and adds the header to each request to `https://trendsfast.com`. The node itself never reads, logs or returns the key, and its error messages never contain it. Keys expire 90 days after creation and can be revoked in the dashboard; when TrendsFast answers 401, create a new key and update the credential. ([TrendsFast: authentication](https://trendsfast.com/docs#auth))

## Operations and costs

| Resource | Operation | Calls | Credits |
| --- | --- | --- | --- |
| Product | Run, for a saved brand context | `POST /v3/trends/niche` with `product` and `context_id` | the product's price, below |
| Product | Run, for a website and description | `POST /v3/trends/niche` with `niche` and no `product`, through the product's lens | 3 |
| Product | Get Quote | `GET /v3/trends/quote?operation=niche&product=…` | free |
| Global Trend | Query | `POST /v3/trends/global` | 1 |
| Question | Ask | `POST /v3/trends/ask` | 5 |
| Result | Get | `GET /v3/trends/results/{result_id}` | free |
| Request | Get by Request ID | `GET /v3/trends/requests/{request_id}` | free |
| Account | Get Wallet | `GET /v3/trends/wallet` | free |
| Account | Get Context | `GET /v3/trends/context` | free |
| Account | Get History | `GET /v3/trends/history` | free |

The five products:

| Product | The question it answers | Price for a saved brand context | Lens for a website and description |
| --- | --- | --- | --- |
| Customers | What are my customers stuck on? | 10 | conversations |
| Trending (API value `niche`) | What is trending in my niche, and next door? | 25 | everything |
| Competitors | What are my competitors doing? | 30 | everything |
| Formats | What videos work in my niche? | 20 | videos |
| Search | What do people search for, and what do AI assistants answer? | 35 | searches |

- These are the public prices on 2026-10-28. **Product > Get Quote** is free and quotes the product's price, which is what a run for a saved brand context costs. A run for a website and description is a plain niche read at 3 credits, whatever the product.
- **An empty result costs 0.** TrendsFast never charges more than the call's **Max Credits**. If the price is above it, TrendsFast answers 402 and charges nothing.
- **Max Credits** is required on every paid operation and defaults to that call's price: the product's price for a saved brand context, 3 for a website and description, 1 for a global trends query and 5 for a question.
- Rereading a result, paging through it and recovering a request are free. Results can be reread for 30 days.
- Accounts on free credits can have 2 queries in flight and start 20 an hour; accounts with paid credits, 5 and 120. ([TrendsFast: limits](https://trendsfast.com/docs#limits))

**Brand source for Product > Run. Prefer a saved brand context.**

- **Saved Brand Context** (the default) sends the product and your `context_id`, at the product's price. The product first collects your brand's own sources fresh, within its price; a source read recently is reused. Customers and Trending may add your communities' rules (`data.communities`), and Trending adds where each topic is in its life (`topic_history`). Set up your brand once in the TrendsFast dashboard, then get its ID for free with **Account > Get Context** (`context.context_id`).
- **Website and Description** sends a description, an optional website and optional details (topics, problems, audiences, competitors, communities, keywords, and more), and no product. It is a plain niche read for 3 credits through the product's lens: Customers reads conversations, Formats videos and Search searches, while Trending and Competitors read everything. **Options > Content Types** replaces the lens. TrendsFast does not collect fresh for it, and it carries no community rules and no topic history: those need a saved brand context. The website is not read during the call.

Every field is checked against the API's limits before anything is sent, such as 3 to 2,000 characters for a description, at most 20 entries in a list and at most 10 communities. A rejected field stops the item with nothing sent and nothing charged.

## The request ID rule

A paid call (**Run**, **Query**, **Ask**) carries exactly one `request_id` (a UUID) and `max_credits`. TrendsFast settles each request ID once: sending it again returns the first outcome (with `usage.replayed`) and never charges twice.

**Leave Request ID empty** and the node creates one for each item. It is a version 5 UUID derived from this n8n instance, this execution, this node and the request's own body. So:

- the same request from the same node in the same execution always carries the same ID. If n8n's **Retry On Fail**, a queue-mode restart or an AI agent repeating an identical tool call sends it again, TrendsFast replays the first result instead of charging again;
- a new execution, or a different input, is a new request and a new ID.

**Set Request ID** to reuse an ID from an earlier output, for example to retry an item that failed.

**Where to find the ID:**

- on success, in the TrendsFast JSON (`request_id`);
- on failure, in the error message, as `(request ID …)`;
- with **On Error: Continue** (either variant), in the failed item's `request_id` field.

**What to do after a failure:**

| What happened | Charged? | Do this |
| --- | --- | --- |
| No answer arrived (timeout, dropped connection), 409 or 5xx | possibly | Read it for free with **Request > Get by Request ID**. If TrendsFast has no record of it (404), send the same request again with the same Request ID. |
| 402: price above Max Credits, or balance too low | no | Raise Max Credits to at least the quote, or add credits, then retry with the same Request ID. |
| 429: rate or concurrency limit | no | Wait for `Retry-After` (usually 60 seconds), then retry with the same Request ID. |
| 400, 401, 403 | no | Fix the field, the key or the key's scope. Nothing was started. |

Never send the same query under a new request ID after an unknown outcome; that is the one way to pay twice. ([TrendsFast: errors](https://trendsfast.com/docs#errors))

**What the node never does.** It never follows a redirect (`disableFollowRedirect`). It never resends a request: each item is exactly one HTTP call, and every HTTP status comes back to the node as a value, so n8n's credential layer has nothing to retry. Its example workflows keep **Retry On Fail** off on every TrendsFast step; keep it off on paid steps you build. Paid calls wait up to 150 seconds, longer than the 120 seconds TrendsFast allows itself, so a slow run is answered instead of cut off; free reads wait 30 seconds.

## Use it as an AI agent tool

The node sets `usableAsTool: true`. In n8n 2.45, checked in its source, every installed node with that flag gets a tool variant, **TrendsFast Tool**, that you attach to an AI Agent node.

- Give each tool one fixed resource and operation, and a fixed **Max Credits**. Let the model fill only what it should choose, such as the question or the brand description, with `$fromAI()`. Do not let the model set Max Credits or Request ID.
- Every tool call is a request of its own. Identical calls in the same execution replay instead of charging again (see [the request ID rule](#the-request-id-rule)).
- The operation descriptions state each price, so the model sees what a call costs.

Forum posts about n8n 1.x mention `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` for community tools. That variable does not exist in n8n 2.45 and is not on n8n's environment variable page; it was not checked on 1.x.

## Output

Each input item produces one output item: the TrendsFast JSON exactly as it arrived. The node does not add, rename or drop fields.

- **Run**, **Query**, **Ask**, **Result > Get** and **Request > Get by Request ID** return a `trends-api-v3` result: `result_id`, `request_id`, `operation`, `generated_at`, `read_at`, `new_research`, `data` and `usage` (with `this_request_credits` and `replayed`), and `next_cursor`. `data.brief` groups the items by use. A Customers or Trending run for a saved brand context may add `data.communities`, and the items of a Trending run for a saved brand context carry `topic_history`; a website-and-description read carries neither.
- **Get Quote**, **Get Wallet**, **Get Context** and **Get History** return `trends-credit-quote-v3`, `credit-wallet-v3`, `trend-context-v3` and `trends-history-v3`.
- **Result > Get** and **Account > Get History** return one page. Put `next_cursor` into **Options > Cursor** to read the next page.

A failed item, with **On Error: Continue**, is `{ error, request_id?, http_status?, response? }`. Here `response` is TrendsFast's own error body, as is. With **Continue (using error output)** it goes to the error output.

The contract is [the V3 OpenAPI document](https://trendsfast.com/v3/openapi.json).

## Example workflows

Import either file with **Workflows > Import from File**. Both are inactive and contain no credentials, recipients or secrets. Their schedules do nothing until you activate the workflow.

- [`examples/weekly-customer-conversations-digest.json`](examples/weekly-customer-conversations-digest.json): every Monday, reads your saved brand context and the Customers quote (both free). It stops before spending anything unless TrendsFast holds a saved brand and the price fits the run's Max Credits of 10. Then it runs **Customers** for that brand, which collects your brand's own sources fresh (at most 10 credits), and formats a digest of where your customers talked, what they asked and the links. Add your own email or Slack node at the end.
- [`examples/monday-trending-with-recovery.json`](examples/monday-trending-with-recovery.json): every Monday, reads your saved brand context (free) and runs **Trending** for it (at most 25 credits). If no answer arrives, or TrendsFast cannot confirm the outcome, it waits a minute and reads the same request ID back for free. It never sends the paid request twice.

## Compatibility

- Built with `@n8n/node-cli` 0.54.4 and tested against `n8n-workflow` 2.45.2, the versions in n8n 2.45 (October 2026).
- n8n Nodes API version 1; strict mode (n8n Cloud eligible lint rules).
- Node.js 22 for development. The package has no runtime dependencies.
- Checked once outside the test suite, on 2026-10-28: n8n-core 2.45.4's `PackageDirectoryLoader`, the loader n8n uses for community packages, loads the built package. It registers the `trendsFast` node and the `trendsFastApi` credential, with the credential tied to the node, the codex categories and both icons. n8n 2.45.5's `convertNodeToAiTool` turns the node into `trendsFastTool` (**TrendsFast Tool**).
- Not yet run inside a live n8n instance; see [What is not verified](#what-is-not-verified).

## Development

Requires Node.js 22 and npm. Commands run from this directory.

```sh
npm ci              # install the pinned dev dependencies
npm run lint        # n8n-node lint: n8n's community-node rules, strict mode
npm test            # n8n-node build, then the offline tests
npm run scan:local  # the static-analysis half of @n8n/scan-community-package
npm run check       # all of the above
npm run dev         # n8n with this node at http://localhost:5678 (Docker or Podman from n8n 3.0)
```

`npm run check` passes: typecheck, lint, build, the tests and the local scan.

The tests run on Node's built-in runner against the built `dist/` and never open a network connection. A fake n8n execution context records each request instead of sending it.

- `test/description.test.mjs`: node and credential description, resources and operations, the cost in every operation, Max Credits defaults per product and brand source, the lens of each product, choices against the OpenAPI enums, and `package.json` rules.
- `test/request.test.mjs`: for every operation, method, path, query and body validated against [the OpenAPI](test/fixtures/openapi-v3.json) with Ajv (JSON Schema 2020-12). Also: a website-and-description run as a 3-credit niche read with no product and the product's lens, the redirect, retry and timeout settings, and input refused before sending.
- `test/requestId.test.mjs`: the RFC 9562 UUIDv5 test vector, derivation and validation of request IDs.
- `test/execute.test.mjs`: `execute()` end to end, covering output as-is, one request per item, request IDs, error messages and items for 308, 402, 409, 429, 503 and lost responses, and that the API key never appears in an error.
- `test/examples.test.mjs`: both example workflows, covering structure, valid TrendsFast parameters, the requests they build, and their Code nodes run against a fixture.

`test/fixtures/openapi-v3.json` is the V3 OpenAPI document generated from TrendsFast commit `d8fb8f48` (SHA-256 `8826d353…52d04d7f`); `test/fixtures/customers-result.json` is a synthetic result that the tests validate against it.

**Why this node is programmatic.** n8n recommends declarative routing for REST APIs ([n8n: choose a node style](https://docs.n8n.io/integrations/creating-nodes/plan/choose-node-method/)). This node uses `execute()` because of the request ID rule: when no answer arrives, the workflow must still learn the request ID to recover or retry without paying twice. Declarative routing hands a transport failure straight to n8n's error handling with no hook to attach that ID. Each call is still one plain authenticated request, built by `nodes/TrendsFast/transport/planCall.ts` and sent with n8n's `httpRequestWithAuthentication`.

## Publishing (maintainers)

The package is published from `github.com/meestierolff/trendsfast-open`, in its `n8n-nodes-trendsfast/` directory (`repository` and `repository.directory` in `package.json`). Keep `author.email` a TrendsFast address: n8n's `@n8n/community-nodes/valid-author` rule, which both `n8n-node lint` and the scanner apply, requires one. It is `mees@trendsfast.com`.

0.1.0 was published on 2026-10-29 from a maintainer's machine, so it has no provenance. Every later version goes through `.github/workflows/n8n-publish.yml` at the repository root.

### How npm publishing is set up

- **Trusted Publisher.** The package's settings on npmjs.com list a GitHub Actions Trusted Publisher for `meestierolff/trendsfast-open` and the workflow file `n8n-publish.yml`, with no environment. The workflow signs in through it with OIDC, so no npm token is stored anywhere.
- **Staging only.** That publisher may run `npm stage publish` but not `npm publish`. A staged version cannot be installed until a maintainer approves it with 2FA, so a pushed tag alone releases nothing.

### Releasing a version

1. **Bump** `version` in `package.json` and `package-lock.json` and add the entry to `CHANGELOG.md`, in a pull request. Run `npm ci && npm run check` in `n8n-nodes-trendsfast/` first.
2. **Tag** the merge commit on `main` as `n8n-nodes-trendsfast@<version>` and push the tag. The workflow checks that the tag names the version in `package.json`, lints, builds and stages the version with provenance.
3. **Approve** it in the package's **Staged Packages** tab on npmjs.com, or with `npm stage approve <stage-id>`. Both ask for 2FA.
4. **Verify:** `npm view n8n-nodes-trendsfast` lists the version, and `npx @n8n/scan-community-package n8n-nodes-trendsfast` passes. It checks provenance, fetches the attested GitHub source, finds this package in it by name and lints it and the tarball.

Never run `npm publish` locally: `prepublishOnly` refuses it, and n8n does not accept nodes published from a local machine. `npm run release` also tags and pushes, but it runs `auto-changelog`, which overwrites this hand-written `CHANGELOG.md`.

### After the first version with provenance

1. **Test in n8n** with a real key: install it, test the credential (free), run **Get Context**, **Get Wallet** and **Get Quote** (free), then one **Customers** run for the saved brand context with Max Credits 10. That last call spends up to 10 real credits and needs its own approval.
2. **Submit** at the [n8n Creator Portal](https://creators.n8n.io/nodes). n8n fetches the package from npm to vet it, and may reject nodes that compete with its paid features.
3. **Record** the n8n node as a delivery channel in TrendsFast's product flow, using paths outside the deploy-excluded `integrations/`.

## Standards this package follows

Checked on 2026-10-28 against n8n's documentation, the `@n8n/node-cli` 0.54.4 package and its templates, and `@n8n/scan-community-package` 0.41.1.

| Requirement | How this package meets it | Source |
| --- | --- | --- |
| Scaffold and commands: `npm create @n8n/node`, `n8n-node build`, `dev`, `lint`, `lint --fix`, `release` | Same layout (`nodes/`, `credentials/`, `icons/`, `dist/`), `tsconfig.json`, scripts and `prepublishOnly: n8n-node prerelease` as the 0.54.4 template | [n8n-node CLI](https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/), [n8n-nodes-starter](https://github.com/n8n-io/n8n-nodes-starter) |
| Name `n8n-nodes-…`, keyword `n8n-community-node-package`, nodes and credentials listed under `n8n` in `package.json` | Yes, with `n8nNodesApiVersion: 1` | [Submit community nodes](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/) |
| No runtime dependencies | `dependencies` is absent; `n8n-workflow` is a `*` peer dependency; everything else is a pinned dev dependency | [Verification guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/) |
| MIT license | `license: MIT` and `LICENSE.md`, copyright TrendsFast (pending the founder's license review) | Verification guidelines |
| Public repository; npm repository URL and author match it | `repository` points at the public `trendsfast-open` with `directory: n8n-nodes-trendsfast`; `author` is TrendsFast with `mees@trendsfast.com` | Verification guidelines |
| Lint passes, strict mode | `n8n-node lint` runs with the unmodified default `eslint.config.mjs` and `"strict": true`, with no errors or warnings | Verification guidelines, [node-cli](https://www.npmjs.com/package/@n8n/node-cli) |
| `npx @n8n/scan-community-package n8n-nodes-PACKAGE` passes | Its static analysis passes locally on the source and the packed tarball (`npm run scan:local`); its provenance and source-fetch checks need the published package | Verification guidelines, [scanner](https://www.npmjs.com/package/@n8n/scan-community-package) |
| Published from GitHub Actions with npm provenance (from May 1, 2026) | `.github/workflows/n8n-publish.yml` at the root of `trendsfast-open`, from the 0.54.4 template with actions pinned to commits, stages each version for a maintainer's 2FA approval ([Releasing a version](#releasing-a-version)); 0.1.0 has no provenance | Submit community nodes |
| No environment variables or file system access | The node reads only its parameters and n8n's helpers; the lint bans `process` and file imports | Verification guidelines |
| English UI, documentation, credential test, password field for the key | Yes; `test` reads the free wallet | Verification guidelines, [UX guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/) |
| Declarative style where possible | Programmatic on purpose, for the request ID rule (see [Development](#development)) | [Choose a node style](https://docs.n8n.io/integrations/creating-nodes/plan/choose-node-method/) |

### What is not verified

- No call to the live TrendsFast API was made: a Run spends real credits. Every request was checked against the OpenAPI document instead.
- The node has not run inside a real n8n instance (`npm run dev` was not run); only n8n's loader and tool conversion were run on it (see [Compatibility](#compatibility)). The example workflows have not been imported into n8n. Their core nodes' type versions (Schedule Trigger 1.2, Set 3.4, Code 2, Wait 1.1, No Operation 1, Sticky Note 1) and parameter names were checked against the node descriptions in n8n-nodes-base 2.45.4, but the files were written by hand, not exported from n8n.
- `n8n-publish.yml` first runs for 0.1.1. npm does not document whether a staged version keeps its provenance statement once approved; step 4 of [Releasing a version](#releasing-a-version) checks it on 0.1.1.
- The scanner's provenance and source checks need a version with provenance, and n8n has not reviewed the node.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [TrendsFast API documentation](https://trendsfast.com/docs)
- [TrendsFast V3 OpenAPI](https://trendsfast.com/v3/openapi.json)

## Version history

- **0.1.1** (2026-10-29): published from GitHub Actions; the node is unchanged. See [CHANGELOG.md](CHANGELOG.md).
- **0.1.0** (2026-10-29): first version, published without provenance.
