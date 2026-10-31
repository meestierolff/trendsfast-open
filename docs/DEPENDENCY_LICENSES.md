# Dependency license record

Each package's own lockfile is the source of these entries. Recorded on 2026-10-31.

| Package                             | Runtime dependencies                           | Development dependencies                                      |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `trendsfast-cli` (`cli/`)           | none                                           | `typescript` 5.9.3 (Apache-2.0), `@types/node` 20.19.43 (MIT) |
| `trendsfast` for Node (`sdk-js/`)   | none                                           | `typescript` 5.9.3 (Apache-2.0), `@types/node` 20.19.43 (MIT) |
| `trendsfast` for Python (`python/`) | none (`dependencies = []`)                     | none; tests use the standard library                          |
| `n8n-nodes-trendsfast`              | none; `n8n-workflow` is a peer provided by n8n | its own lockfile, checked by its CI                           |
| Repository root                     | none (private package)                         | `prettier`                                                    |

The CLI bundles the Node SDK's source at build time; neither ships third-party code. The
version-1 package and its runtime dependencies were removed on 2026-10-29 and remain at commit
`9e7053b`.

This inventory is read from package metadata. It does not make a broader legal conclusion.
