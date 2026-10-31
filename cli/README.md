# trendsfast-cli

The `trendsfast` command: install TrendsFast's market-evidence skill into your coding agents
once, sign in through the browser, and let the agent ask what your customers are stuck on,
what is trending in your niche, what competitors post, which videos work and what people
search for and AI assistants answer, with sources.

```bash
npx -y trendsfast-cli@latest init
```

Zero runtime dependencies. Node 20 or newer. MIT.

## What `init` does

1. Copies one skill, `trendsfast`, with its references to `~/.agents/skills/trendsfast`, and
   links it into the global skills folder of each coding agent installed on this machine, and
   only those: Claude Code (`CLAUDE_CONFIG_DIR`), Codex (`CODEX_HOME`), Cursor, Windsurf, Gemini
   CLI, GitHub Copilot, OpenCode (`XDG_CONFIG_HOME`), OpenClaw, Continue, Roo Code, Factory
   Droid, OpenHands and Hermes Agent.
2. Records it in `~/.agents/.skill-lock.json` the way `npx skills` does, so the two installers
   agree. Running it again updates what it installed and keeps the skill folder if you changed
   it, unless `--force`.
3. Signs in, unless `--no-login` or a key is already here.
4. Checks the result with free reads, and prints the optional MCP setup line for each agent it
   found.

It never writes the key into an agent's config or a `.env` file, and never changes an agent's
own tools or settings. `--agent claude-code` limits it to one agent; `--dry-run` only reports.

It is one skill because agents read every installed skill's description at startup, in every
project: about 70 tokens a session, where the eight skills it replaced cost about 620. The
skill's `SKILL.md` (about 1,190 tokens, from 2,250) loads only when a task needs market
evidence, and each reference (one per product and workflow, plus setup, REST and errors) only
for its job.

## Sign in

The owner signs in at trendsfast.com and picks a project; TrendsFast creates a project key and
returns it sealed to a key pair made on this machine (X25519, HKDF-SHA256, AES-256-GCM), so the
browser, its history and the agent only ever see the sealed form. The key is stored at
`${XDG_CONFIG_HOME:-~/.config}/trendsfast/credentials.json` (directory 0700, file 0600) and
never printed; `TRENDSFAST_API_KEY` overrides it.

| Where | Command |
| --- | --- |
| Your own terminal | `trendsfast login` (waits up to 10 minutes) |
| An agent's shell on your computer | `trendsfast login --background`, finish in the browser, then `trendsfast whoami` |
| Browser on another machine (cloud agents, containers, SSH) | `trendsfast login --code-flow`, then `trendsfast login --code <code>` |
| A key from the dashboard | `trendsfast login --paste` |

`trendsfast login --status`, `trendsfast whoami` and `trendsfast logout` do what they say.

## Commands

```
Set up       init · login · logout · whoami · doctor
Free reads   context · credits · quote <command> · history · result <id> · request <id>
Products     customers (10) · trending (25) · competitors (30) · formats (20) · search (35)
Index reads  global (1) · niche "<description>" (3) · ask "<question>" (5) · discover (5)
```

`trendsfast --help` and `trendsfast <command> --help` document every flag.

## Paid calls

- The free quote is printed to stderr first.
- Without a terminal, a paid command needs `--max-credits` at or above the quote; otherwise it
  exits 1 and prints the exact command with the price. At a terminal it asks unless `--yes`.
- The request ID is written to `${XDG_STATE_HOME:-~/.local/state}/trendsfast/requests/<id>.json`
  before anything is sent. A lost answer is retried with the same ID, never charged twice, and
  read back once; an outcome that is still unknown exits 6 with `trendsfast request <id>`.
- `--dry-run` shows the quote and the request without sending it.

## Output

stdout carries data only: a compact text summary by default (each item's title, platform,
observed time, measured signal, link, community or hook; coverage; next steps), `--json` for
the compact view as JSON, `--format full` for the whole response. Receipts and errors go to
stderr. `-o name.json` also writes the whole response into `.trendsfast/`, which the CLI
creates with its own `.gitignore`.

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | usage, or no confirmed brand context |
| 2 | auth or scope |
| 3 | credits, or `--max-credits` below the price |
| 4 | conflict: request ID reused, brand changed, result gone |
| 5 | rate limited |
| 6 | outcome unconfirmed: run `trendsfast request <id>` |
| 7 | network or server |

## Privacy

The CLI talks only to the API origin (https://trendsfast.com by default). Its User-Agent is
`trendsfast-cli/<version>`, plus `(+agent: <id>)` when a coding agent's environment variables
show one is running it (for example `CLAUDECODE` or `CODEX_SANDBOX`), so TrendsFast can see
which agents use it. Set `TRENDSFAST_CLI_DISABLE_AGENT_ORIGIN=1` to leave the agent out. There
is no other telemetry and no update check.

Docs: https://trendsfast.com/docs. SDK: [`trendsfast`](https://www.npmjs.com/package/trendsfast).
