export const PACKAGE_NAME = "trendsfast-agent";
export const PACKAGE_VERSION = "0.1.0-alpha.0";
export const AGENT_SKILL_VERSION = "1.0.0";
export const REMOTE_MCP_ENDPOINT = "https://trendsfast.com/api/mcp";
export const REMOTE_MCP_DOCUMENTATION_URL = "https://trendsfast.com/mcp";
export const REMOTE_MCP_PROTOCOL_VERSION = "2026-07-28";
export const REMOTE_MCP_CONTRACT_VERSION = "trendsfast-remote-mcp-v1";
export const DEFAULT_PACKAGE_SOURCE = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;
export const MAX_REMOTE_RESPONSE_BYTES = 1_048_576;
export const MAX_REMOTE_REQUEST_BYTES = 262_144;
export const DEFAULT_REMOTE_TIMEOUT_MS = 30_000;

export const REMOTE_MCP_TOOL_NAMES = [
  "trendsfast_project_context_get",
  "trendsfast_today_create",
  "trendsfast_today_status_get",
  "trendsfast_brief_latest_get",
  "trendsfast_brief_get",
  "trendsfast_creative_handoff_get",
  "trendsfast_sources_get",
] as const;

export type RemoteMcpToolName = (typeof REMOTE_MCP_TOOL_NAMES)[number];

/** SHA-256 of canonicalized, intentionally public descriptors from contract V1. */
export const REMOTE_MCP_DESCRIPTOR_SHA256: Readonly<
  Record<RemoteMcpToolName, string>
> = {
  trendsfast_project_context_get:
    "a28e15879d917335d447ba01c53ab8191474faddf884c152040a2f8f49bfe3d4",
  trendsfast_today_create:
    "1d4412e2909cb0f7cc66da812663f2a03685db3b598d2a30bfc835f70c06e413",
  trendsfast_today_status_get:
    "c64a3b5578b343573464ff5dfb269f8a03884fcbd37cfcf8c968996c53a3849b",
  trendsfast_brief_latest_get:
    "715c8231ddd38de35ae66440ea428d6a3a237bed8e06ca2f55b2805234a3e730",
  trendsfast_brief_get:
    "d327ab1fce229468883dc1327b3dd8c236f7593c2f1a18647a3ab3b2c444c7be",
  trendsfast_creative_handoff_get:
    "44d087b89c014a5226ae6535b5373f0f2fffe86f349d1314aa07769bc49f030a",
  trendsfast_sources_get:
    "7a48bdd677cdaa7224b7dd79fdd22fa922251fca35bf4022b015081ae3389cfb",
};

export const SUPPORTED_CLIENTS = ["generic", "claude-code", "codex"] as const;
export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];

export const CONTENT_CAPABILITIES = [
  "founder_text",
  "founder_on_camera",
  "founder_voice_over",
  "talking_head",
  "faceless_text_overlay",
  "screen_recording",
  "ai_avatar",
  "carousel",
  "product_demo",
  "long_form",
] as const;
export type ContentCapability = (typeof CONTENT_CAPABILITIES)[number];

export const SAFE_REMOTE_ERROR_CODES = [
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_REVOKED",
  "AUTH_EXPIRED",
  "INSUFFICIENT_SCOPE",
  "RESOURCE_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "COST_ADMISSION_DENIED",
  "CAPABILITY_UNAVAILABLE",
  "INVALID_TOOL_INPUT",
  "INTERNAL_FAILURE",
] as const;

export const SAFE_REMOTE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: "A project-scoped API key is required.",
  AUTH_INVALID: "The project-scoped API key is invalid.",
  AUTH_REVOKED: "The project-scoped API key has been revoked.",
  AUTH_EXPIRED: "The project-scoped API key has expired.",
  INSUFFICIENT_SCOPE: "The project-scoped API key lacks the required scope.",
  RESOURCE_NOT_FOUND: "The requested resource was not found.",
  IDEMPOTENCY_CONFLICT:
    "The idempotency key is already bound to a different request.",
  RATE_LIMITED: "The request rate limit was exceeded.",
  COST_ADMISSION_DENIED:
    "The request was not admitted by the bounded cost policy.",
  CAPABILITY_UNAVAILABLE: "A required confirmed capability is unavailable.",
  INVALID_TOOL_INPUT: "The registered tool input is invalid.",
  INTERNAL_FAILURE: "The request could not be completed safely.",
};
