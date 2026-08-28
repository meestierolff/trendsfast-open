# TrendsFast Agent

Clean-room public protocol and client tooling for the live TrendsFast Remote MCP
server. The package installs a credential-free agent skill, configures tested
local MCP clients, and runs a secure stdio bridge to
`https://trendsfast.com/api/mcp`.

The package does not contain TrendsFast research, ranking, generation, provider,
customer, deployment or private-cloud implementation. It has no telemetry,
postinstall hook, publishing action or scheduling action.

The package boundary is documented in [docs/PUBLIC_BOUNDARY.md](docs/PUBLIC_BOUNDARY.md).
Until the exact package is merged and accepted, installation commands remain
deliberately unpublished here.

## Commands

Once invoked from a reviewed package source, the CLI provides exactly:

```text
trendsfast install
trendsfast doctor --json
trendsfast demo
trendsfast demo --create --idempotency-key <uuid-v4> --objective <text> --capability <name>
trendsfast mcp
trendsfast uninstall
trendsfast version
```

`install` supports generic stdio MCP, Claude Code, and Codex. It can inherit
`TRENDSFAST_API_KEY` without writing it to disk, or—after explicit consent—put
it in a mode-0600 protected file. Generated client configuration never contains
the raw key. `doctor` and the default `demo` are read-only.

`demo --create` is deliberately separate: it needs an explicit UUID v4,
objective, one or more confirmed content capabilities, and interactive
confirmation unless `--yes` is supplied. It makes one create call, polls only
through the status tool, and never approves, delivers, publishes, or schedules.

See [SECURITY.md](SECURITY.md) for responsible disclosure and credential
handling.
