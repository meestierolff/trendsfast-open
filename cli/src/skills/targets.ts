/**
 * Where each coding agent keeps its global skills. A harness counts as installed when its
 * own directory exists; `init` writes only into installed ones. The table is the 13 agents
 * Firecrawl's native installer supports (the same locations `npx skills` uses), with the
 * agents' own overrides honoured: CLAUDE_CONFIG_DIR, CODEX_HOME and XDG_CONFIG_HOME.
 */
import { join } from "node:path";
import { homeDirectory, type Env } from "../sdk/credentials.js";

export interface Harness {
  id: string;
  name: string;
  /** The agent's own directory; it exists only where the agent is installed. */
  detectDir: string;
  /** Where the agent reads global skills. */
  skillsDir: string;
}

export function harnesses(env: Env): Harness[] {
  const home = homeDirectory(env);
  const at = (id: string, name: string, base: string): Harness => ({ id, name, detectDir: base, skillsDir: join(base, "skills") });
  const config = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return [
    at("claude-code", "Claude Code", env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude")),
    at("cursor", "Cursor", join(home, ".cursor")),
    at("windsurf", "Windsurf", join(home, ".codeium", "windsurf")),
    at("codex", "Codex", env.CODEX_HOME?.trim() || join(home, ".codex")),
    at("continue", "Continue", join(home, ".continue")),
    at("roo", "Roo Code", join(home, ".roo")),
    at("gemini-cli", "Gemini CLI", join(home, ".gemini")),
    at("github-copilot", "GitHub Copilot", join(home, ".copilot")),
    at("droid", "Factory Droid", join(home, ".factory")),
    at("opencode", "OpenCode", join(config, "opencode")),
    at("openclaw", "OpenClaw", join(home, ".openclaw")),
    at("openhands", "OpenHands", join(home, ".openhands")),
    at("hermes-agent", "Hermes Agent", join(home, ".hermes")),
  ];
}

/** The cross-agent skills directory every installer shares, and its lock file. */
export function canonicalSkillsDir(env: Env): string {
  return join(homeDirectory(env), ".agents", "skills");
}

export function skillLockPath(env: Env): string {
  return join(homeDirectory(env), ".agents", ".skill-lock.json");
}
