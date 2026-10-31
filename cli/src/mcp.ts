/**
 * The optional MCP setup line for each client `init` finds, word for word as
 * https://trendsfast.com/agents prints it. The private product repository checks these
 * against the site's own snippets, so the two cannot drift. Each reads the key from the
 * client's environment; none writes a key into a config file.
 */
export const MCP_ENDPOINT = "https://trendsfast.com/api/mcp/v3";
const KEY_ENV = "TRENDSFAST_API_KEY";

export const MCP_SNIPPETS: Readonly<Record<string, { name: string; snippet: string }>> = {
  "claude-code": {
    name: "Claude Code",
    snippet: `claude mcp add --transport http trendsfast \\\n  ${MCP_ENDPOINT} \\\n  --header "Authorization: Bearer $${KEY_ENV}"`,
  },
  codex: {
    name: "Codex",
    snippet: `codex mcp add trendsfast \\\n  --url ${MCP_ENDPOINT} \\\n  --bearer-token-env-var ${KEY_ENV}`,
  },
  cursor: {
    name: "Cursor",
    snippet: `// ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "trendsfast": {\n      "url": "${MCP_ENDPOINT}",\n      "headers": { "Authorization": "Bearer \${env:${KEY_ENV}}" }\n    }\n  }\n}`,
  },
  openclaw: {
    name: "OpenClaw",
    snippet: `openclaw mcp add trendsfast \\\n  --url ${MCP_ENDPOINT} \\\n  --env ${KEY_ENV}`,
  },
  other: {
    name: "Other MCP client",
    snippet: `Endpoint:  ${MCP_ENDPOINT}\nTransport: Streamable HTTP\nAuth:      Bearer token from ${KEY_ENV}`,
  },
};
