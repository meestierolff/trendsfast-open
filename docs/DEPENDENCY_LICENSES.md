# Dependency license record

The public package uses three exact direct runtime dependencies:

| Package                        | Version | License      |
| ------------------------------ | ------- | ------------ |
| `@modelcontextprotocol/server` | `2.0.0` | MIT          |
| `smol-toml`                    | `1.8.0` | BSD-3-Clause |
| `zod`                          | `4.4.3` | MIT          |

The direct `zod` pin closes the official server SDK's compatible transitive
range at the exact schema runtime reviewed for consumer and npx installs.

The official `@modelcontextprotocol/client` package is development-only and is
used by the synthetic stdio acceptance harness. Package CI checks every exact
lockfile package against the reviewed permissive-license allowlist and rejects
dependency or license drift.

This inventory is generated from published package metadata during package
review. It does not make a broader legal conclusion.
