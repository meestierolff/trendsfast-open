import { CLI_VERSION } from "./version.js";

/** Environment variables coding agents set in the processes they start, innermost first:
 * an agent run inside another inherits the outer one's variables too. They only name the
 * agent; nothing else about the machine or the command is sent. */
const AGENT_ENV: readonly (readonly [string, readonly string[]])[] = [
  ["codex", ["CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED", "CODEX_THREAD_ID"]],
  ["gemini-cli", ["GEMINI_CLI"]],
  ["opencode", ["OPENCODE"]],
  ["cursor", ["CURSOR_AGENT"]],
  ["goose", ["GOOSE_TERMINAL"]],
  ["cline", ["CLINE_ACTIVE"]],
  ["claude-code", ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]],
];

const set = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "0" && normalized !== "false";
};

/** The agent running this command, if its environment says so. */
export function detectAgent(env: Record<string, string | undefined>): string | undefined {
  if (["1", "true", "yes", "on"].includes(env.TRENDSFAST_CLI_DISABLE_AGENT_ORIGIN?.trim().toLowerCase() ?? ""))
    return undefined;
  for (const [agent, variables] of AGENT_ENV) {
    if (variables.some((name) => set(env[name]))) return agent;
    if (agent === "codex" && Object.keys(env).some((name) => name.startsWith("CODEX_MANAGED_BY_") && set(env[name])))
      return agent;
  }
  return undefined;
}

/** `trendsfast-cli/0.1.1`, or `trendsfast-cli/0.1.1 (+agent: claude-code)`. */
export function userAgent(env: Record<string, string | undefined>): string {
  const agent = detectAgent(env);
  return `trendsfast-cli/${CLI_VERSION}${agent ? ` (+agent: ${agent})` : ""}`;
}
