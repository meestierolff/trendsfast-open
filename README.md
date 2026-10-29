# TrendsFast agent kit

TrendsFast answers five questions about a brand's market with sourced evidence: where its
customers talk and what they are stuck on, what is trending in its niche, what its
competitors post, which videos work, and what people search for and AI assistants answer.

This kit lets an agent ask those questions:

- the `trendsfast` skill for Claude Code, OpenClaw, Codex and any client that reads
  `SKILL.md`;
- a Claude Code plugin that bundles the skill with the remote MCP server;
- `n8n-nodes-trendsfast`, an n8n community node, with example workflows.

The REST API and MCP server it calls are documented at https://trendsfast.com/docs.

## Before you start

Sign in at https://trendsfast.com/setup, add your brand and create an API key. A verified
account gets 100 free credits once, enough to run each product at least once. Keep the key
in your environment as `TRENDSFAST_API_KEY`. Never paste it into a chat, a URL or a
command.

## Install

**Claude Code**: the plugin adds the skill and the MCP server, and asks for your key when
you enable it. The key is kept in your system's secure storage.

```
/plugin marketplace add meestierolff/trendsfast-open
/plugin install trendsfast@trendsfast
```

**Any agent that reads skills** (Claude Code, Codex, Cursor, OpenCode and others), through
[skills.sh](https://skills.sh):

```bash
npx skills add meestierolff/trendsfast-open --skill trendsfast
```

**OpenClaw**: install `trendsfast` from ClawHub. The skill loads once
`TRENDSFAST_API_KEY` is set.

**n8n**: install the community node `n8n-nodes-trendsfast` (Settings → Community
Nodes), add a TrendsFast credential with your key, and start from one of its example
workflows. It also works as a tool for n8n's AI Agent. See
[n8n-nodes-trendsfast/README.md](n8n-nodes-trendsfast/README.md).

**MCP only**: add `https://trendsfast.com/api/mcp/v3` (Streamable HTTP) with the header
`Authorization: Bearer <your key>`. The exact command for each client is at
https://trendsfast.com/agents.

## What it costs

| Question                                                     | Product       | Credits |
| ------------------------------------------------------------ | ------------- | ------- |
| What are my customers stuck on?                              | `customers`   | 10      |
| What's trending in my niche, and next door?                  | `niche`       | 25      |
| What are my competitors doing?                               | `competitors` | 30      |
| What videos work in my niche?                                | `formats`     | 20      |
| What do people search for, and what do AI assistants answer? | `search`      | 35      |

Reading your brand, your balance, a quote or a saved result is free, and an empty result
costs 0 credits. Plans and packs: https://trendsfast.com/pricing.

## What the skill will and will not do

- **One call per question.** It reads your brand and balance first, says what the call
  costs, and runs it once.
- **No double charges.** Every paid call carries one `request_id`. A retry reuses it, so
  a lost response is never charged twice.
- **Read-only.** It reports evidence with its source, date, signal and coverage. It never
  posts, schedules, messages anyone or buys credits for you.
- **Community rules first.** It reads each community's rules before it drafts anything
  for it. You decide what to post.

## Maintainers

The skill is checked against the live contract in the private product repository. Its
prices, tool names, REST paths and request bodies are compared with the server's own
tariffs, tool catalog, OpenAPI document and input schemas. A change there fails the check
before the kit can drift.

To validate locally:

```bash
claude plugin validate .
```

Publishing is a manual, reviewed step:

1. **GitHub.** Push this directory to `meestierolff/trendsfast-open`, which serves both
   the plugin marketplace and skills.sh.
2. **ClawHub.** Run `clawhub login`, then
   `clawhub skill publish ./skills/trendsfast --slug trendsfast --name "TrendsFast"`.
3. **Anthropic's plugin directory.** Submit through the form linked from
   https://code.claude.com/docs/en/plugins/publish.
4. **npm and n8n.** Follow the publishing steps in
   [n8n-nodes-trendsfast/README.md](n8n-nodes-trendsfast/README.md), then request n8n's
   verification.

## License

MIT. See [LICENSE](LICENSE).

## Legacy V1 tooling

This repository used to carry the V1 `trendsfast-agent` CLI and stdio bridge for the retired
Remote MCP V1. It is kept, unchanged, at commit `9e7053b` for integrations that still pin it.
New integrations use the V3 kit above.
