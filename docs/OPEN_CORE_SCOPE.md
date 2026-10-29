# Open-Core Scope

This public tooling repository started from one clean, unrelated founder-owned
commit. It is not a fork, filtered copy, or redistribution of a private or
historical implementation.

## Intended public scope

- the credential-free `trendsfast` agent skill for the V3 API and MCP server;
- a Claude Code plugin and marketplace that connect the remote MCP server;
- `n8n-nodes-trendsfast`, an n8n community node over the public V3 REST API, with
  example workflows;
- synthetic fixtures and tests; and
- public boundary, provenance and onboarding documentation.

The V3 kit replaced the V1 CLI and stdio tooling on 2026-10-29, with the founder's
approval of 2026-10-28. The V1 tooling remains at commit `9e7053b`.

## Excluded private scope

- adaptive or production query generation;
- managed provider implementations;
- source routing and lookback policy;
- production ranking weights and quality thresholds;
- production prompts, model inventory, and fallback policy;
- provider prices, cost ceilings, and abuse controls;
- customer, outcome, operations, and dogfood records;
- production deployment scripts and configuration values.

No private-cloud or historical-public implementation may be copied here.
Future public capabilities require their own graph authorization, clean-room
review, dependency review and license decision.
