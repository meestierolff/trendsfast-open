# Open-Core Scope

This private staging repository starts with an unrelated Git history. It is not a
fork, filtered copy, or redistribution of the existing AGPL implementation.

## Intended public scope

- stable API and schema contracts;
- SDKs and OpenAPI;
- MCP tool contracts and a credential-free agent skill;
- provider plugin interfaces;
- synthetic reference fixtures;
- evidence and provenance types;
- generic state, security, and idempotency framework;
- methodology and source limitations.

## Excluded private scope

- adaptive or production query generation;
- managed provider implementations;
- source routing and lookback policy;
- production ranking weights and quality thresholds;
- production prompts, model inventory, and fallback policy;
- DistributionAsset implementation;
- provider prices, cost ceilings, and abuse controls;
- customer, outcome, operations, and dogfood records;
- production deployment scripts and configuration values.

No implementation may be copied from trendsfast-cloud until qualified review
approves the license and dependency boundary.
