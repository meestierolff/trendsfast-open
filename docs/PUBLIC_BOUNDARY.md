# Public package boundary

Classification: `PUBLIC_PROTOCOL_AND_CLIENT_TOOLING_ONLY`.

This repository contains a clean-room agent client for the intentionally public
TrendsFast Remote MCP contract. The remote service remains the sole application,
entitlement, idempotency, cost-admission, research, ranking, and generation
boundary.

## Allowed material

- the public endpoint, protocol and contract versions;
- exact public tool names and runtime-fetched public descriptors;
- public input, output and safe-error contracts;
- the CLI, local stdio bridge and supported-client configuration adapters;
- the credential-free agent skill and public documentation;
- synthetic fixtures and security, installation and transport tests.

## Excluded material

This repository must not contain provider adapters or routing, query planning,
scoring or trend thresholds, prompts, model selection or fallback logic,
private cost or rate policy, production environment or database code, customer
or private product fixtures, private release tooling or journals, raw production
results, owner or user identity, or secrets.

No source file is copied from a private-cloud or historical-public
implementation. Public wire facts are independently reconstructed from the
live descriptor and the reviewed intentionally public contract. Runtime
descriptors are fetched from the authenticated endpoint and rejected unless
their count, order, protocol identity, contract markers, and canonical SHA-256
fingerprints all match contract V1 exactly.

## Provenance

| Public fact                             | Source                                                                                      | Use                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Endpoint, protocol and contract version | Live `https://trendsfast.com/mcp` and reviewed Remote MCP V1 contract                       | Connection validation                                                     |
| Seven ordered tool names                | Live `tools/list` and reviewed Remote MCP V1 contract                                       | Drift detection and skill guidance                                        |
| Tool schemas and annotations            | Authenticated live `tools/list` plus canonical hashes of the reviewed public V1 descriptors | Fail-closed drift check and unchanged forwarding through the local bridge |
| Public-safe errors                      | Live Remote MCP responses and reviewed Remote MCP V1 contract                               | Redacted CLI diagnostics                                                  |
| Client configuration                    | Current official client documentation                                                       | Narrow, tested adapters                                                   |

Production payloads, credentials, private implementation and private evidence
are never used as public fixtures.
