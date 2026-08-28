# Security

Report a suspected vulnerability privately through GitHub Security Advisories
for `meestierolff/trendsfast-open`. Do not include a TrendsFast API key, remote
payload, customer data, Authorization header, or private provider detail in an
issue or reproduction.

The CLI accepts a project key only from hidden stdin, inherited
`TRENDSFAST_API_KEY`, or its protected mode-0600 credential file. It rejects API
keys in command-line arguments and never writes a raw key into generated client
configuration. Revoke a potentially exposed key through the private TrendsFast
key-management surface before sharing sanitized diagnostics.

The local bridge connects only to `https://trendsfast.com/api/mcp`, rejects
redirects and protocol or descriptor drift, bounds messages, and stores no MCP
message content or session.
