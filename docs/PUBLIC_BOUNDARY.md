# Public package boundary

Classification: `PUBLIC_PROTOCOL_AND_CLIENT_TOOLING_ONLY`.

This repository holds the public TrendsFast agent kit. Its parts:

- the `trendsfast` CLI (`cli/`) and the `trendsfast` SDKs for Node (`sdk-js/`) and Python (`python/`);
- the `trendsfast` agent skill;
- a Claude Code plugin that connects the remote MCP server;
- `n8n-nodes-trendsfast`, an n8n community node for the V3 REST API.

The remote service remains the only application, entitlement, idempotency, cost-admission, research, ranking and generation boundary.

## Allowed material

- The public endpoints: `https://trendsfast.com/api/mcp/v3` and `https://trendsfast.com/v3/...`.
- Public tool names, operations, prices and safe error codes.
- The published V3 OpenAPI document (`https://trendsfast.com/v3/openapi.json`), used as a test fixture.
- The CLI and SDK clients of the public API, the agent skill, the plugin and marketplace manifests, and the n8n node, credential and example workflows.
- Synthetic fixtures, tests and public documentation.

## Excluded material

This repository must not contain any of the following:

- provider adapters or routing, query planning, or scoring or trend thresholds;
- prompts, model selection or fallback logic;
- private cost or rate policy;
- production environment or database code;
- customer or private product fixtures;
- private release tooling or journals;
- raw production results, owner or user identity, or secrets.

The kit is written as public material: client tooling over the public contract. It contains no private implementation. Its prices, tool names, paths and request bodies are checked against the live contract before each change is published, and its fixtures are synthetic.

## Provenance

| Public fact                      | Source                                                   | Use                                     |
| -------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| Endpoints and contract version   | Live `https://trendsfast.com/v3/openapi.json` (V3)       | Skill recipes, plugin and node requests |
| Tool names and costs             | Live `tools/list` at `https://trendsfast.com/api/mcp/v3` | Skill guidance                          |
| Product names, questions, prices | `https://trendsfast.com/pricing` and `llms.txt`          | Skill, plugin README and node catalog   |
| Client and marketplace formats   | Current official Claude Code, OpenClaw and n8n docs      | Plugin manifests, skill gating, node    |

Production payloads, credentials, private implementation and private evidence are never used as public fixtures.

The V1 CLI and stdio bridge that this repository used to carry remain available at commit `9e7053b`. They are legacy and receive no new work.
