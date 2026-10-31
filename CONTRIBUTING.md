# Contributing

Thanks for helping make TrendsFast better for agents. This repository holds the open-source
clients of the TrendsFast API:

- the CLI;
- the SDKs for Node and Python;
- the agent skill;
- the Claude Code plugin;
- the n8n node.

The API, the trend index and the website are a hosted service and are not in this repository.

## Before you open a pull request

- **Open an issue first** for anything larger than a fix, so we can agree on the shape before
  you spend time on it.
- **Keep the clients in line with the API.** Prices, error codes, enums and paths come from the
  live API's contract (https://trendsfast.com/v3/openapi.json). The test fixtures are
  responses produced by the API's own response schema. A change that makes a client disagree
  with the API cannot be merged; if the API is wrong, open an issue.
- **Stay token-efficient.** Agents load the skill's description on every session, so it stays
  under 300 characters. The router stays lean and the details live in `references/`. Tests
  enforce these budgets.
- **Never handle secrets in examples.** No real keys, no keys in URLs or command lines, and never
  ask a user to paste a key into a chat.

## Run the tests

Every package runs offline, against fixtures:

```bash
(cd cli && npm ci && npm test)
(cd sdk-js && npm ci && npm test)
(cd python && python3 -m unittest discover -v)
(cd n8n-nodes-trendsfast && npm ci && npm test)
```

## Style

- Plain, specific language in docs and help text. Say what a command does and what it costs.
- No new runtime dependencies in the CLI or SDKs without discussion; both ship with none.
- One change per pull request, with a description of why.

## Releases

Maintainers publish to npm and PyPI. Each version is approved with two-factor
authentication; an n8n node version is staged and approved before it goes live.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md), never in a
public issue.
