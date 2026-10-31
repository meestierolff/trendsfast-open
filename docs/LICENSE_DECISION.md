# License decision

Target: MIT for the `trendsfast-agent` public protocol and client-tooling
package.

The repository began with one clean, unrelated founder-owned staging commit.
The package code and documentation are newly authored for this repository. No
private-cloud implementation, frozen AGPL repository code, third-party source,
customer data, or private fixture is included. Direct runtime dependencies are
independently licensed and audited from their published packages.

This records the package decision only. It is not a broader legal conclusion.
The founder authorized MIT only if those clean-room and repository-boundary
facts are proven. This record documents that narrow source decision; it is not
qualified legal advice or a broader legal conclusion. The manifest therefore
keeps npm publication disabled pending separate qualified license review plus
the registry-identity and authentication gates. An immutable GitHub-SHA npx
release may proceed after the repository, dependency, secret and package
acceptance gates pass.

## The CLI and SDKs (2026-10-31)

The `trendsfast-cli` command and the `trendsfast` SDKs for Node and Python are newly authored,
first-party MIT code. None of them has a runtime dependency (see `DEPENDENCY_LICENSES.md`), so
none ships third-party code. They are published the way the n8n node is: the founder approves
each version with two-factor authentication from their own registry account. This record adds no
qualified legal conclusion. The gate recorded above for the original package is unchanged.
