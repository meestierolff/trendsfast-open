# Setting up TrendsFast for an agent

## Install once

```bash
npx -y trendsfast-cli@latest init
```

This copies the TrendsFast skill to `~/.agents/skills/trendsfast` and links it into the global
skills folder of each coding agent installed on the machine (Claude Code, Codex, Cursor, Gemini
CLI, OpenCode, Windsurf, GitHub Copilot, OpenClaw and others), then signs in. It is safe to run
again. `--agent claude-code` limits it to one agent, `--no-login` skips signing in, `--dry-run`
only shows what it would do. It never writes the key into an agent's config or a `.env` file.

`npm install -g trendsfast-cli` keeps the `trendsfast` command on the PATH; otherwise prefix
commands with `npx -y trendsfast-cli@latest`.

## Sign in

The key is created by TrendsFast after the person signs in, sealed to a key pair made on this
machine, and stored by the CLI at `${XDG_CONFIG_HOME:-~/.config}/trendsfast/credentials.json`
(0600). It never passes through the conversation.

| Where the agent runs | Run | Then |
| --- | --- | --- |
| On the person's computer, in an agent's shell | `trendsfast login --background` | Ask the person to finish in the browser, then run `trendsfast whoami`. The listener keeps waiting for 10 minutes after the command returns. |
| On the person's computer, in their own terminal | `trendsfast login` | It waits up to 10 minutes, so give the shell at least that long. |
| Somewhere else: Claude Code on the web, Codex cloud, a devcontainer, SSH | `trendsfast login --code-flow` | The person opens the address, approves, and passes back the code the page shows. Run `trendsfast login --code <code>`. The code opens only with the private key kept on this machine, so it is safe in a chat. |
| Browser sign-in not offered | Create a key at https://trendsfast.com/dashboard/api-keys | The person runs `trendsfast login --paste` in their own terminal. |

`trendsfast login --status` says whether a sign-in is waiting, finished, cancelled or expired.
`trendsfast whoami` shows the project, the key's visible prefix, its expiry and the balance; it
never shows the key. `trendsfast logout` forgets it. In CI, set `TRENDSFAST_API_KEY` instead;
it takes precedence over the stored key.

## MCP, optionally

The skill and the CLI work without it. `init` prints the line for each agent it finds; any
other client connects over Streamable HTTP to https://trendsfast.com/api/mcp/v3 with
`Authorization: Bearer $TRENDSFAST_API_KEY`, the key set by the person in that client's
environment.

## Check

`trendsfast doctor` checks Node, the key, the connection, the brand context and the installed
skill, and prints the fix for anything that fails. Every check is free.

## The brand

Products run on the brand's confirmed context. If `trendsfast context` says there is none, the
person adds and confirms their brand at https://trendsfast.com/dashboard. Until then,
`trendsfast niche "<description>"` reads a niche they describe (3 credits).
