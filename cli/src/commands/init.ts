/**
 * `trendsfast init`: set an agent up once. It installs the bundled skill for every coding
 * agent installed here (and the shared ~/.agents/skills), signs in unless told not to,
 * checks the result with free calls only, and prints the optional MCP line per client.
 * It never writes to an agent that is not installed, never writes the key into a config or
 * .env file, and never changes an agent's own tools or settings.
 */
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { FlagSpec } from "../args.js";
import type { Context } from "../context.js";
import { interactive } from "../io.js";
import { confirm } from "../login/paste.js";
import { loginPreflight } from "../login/preflight.js";
import { MCP_SNIPPETS } from "../mcp.js";
import { API_KEYS_URL, creditsLabel } from "../sdk/catalog.js";
import { normalizeBaseUrl } from "../sdk/client.js";
import { homeDirectory } from "../sdk/credentials.js";
import { installSkills, installedHarnesses, type InstallReport } from "../skills/install.js";
import { harnesses } from "../skills/targets.js";
import { LOGIN_FLAGS, login } from "./login.js";
import { failure } from "./shared.js";

export const BUNDLE_DIR = fileURLToPath(new URL("../../skills", import.meta.url));

export const INIT_FLAGS: FlagSpec[] = [
  { name: "agent", short: "a", type: "list", value: "<id>", help: "Only these agents (repeatable or comma-separated); see the list below" },
  { name: "all", type: "boolean", help: "Every agent installed here, without asking (the default set)" },
  { name: "force", type: "boolean", help: "Replace skill folders you changed or another source installed" },
  { name: "yes", short: "y", type: "boolean", help: "Do not ask before installing" },
  { name: "dry-run", type: "boolean", help: "Show what would be installed, write nothing, do not sign in" },
  { name: "no-login", type: "boolean", help: "Install the skill only; sign in later with trendsfast login" },
  ...LOGIN_FLAGS.filter((flag) => ["background", "foreground", "code-flow", "no-browser"].includes(flag.name)),
];

const tilde = (path: string, home: string) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path);

function summarize(actions: string[]): string {
  const counts = new Map<string, number>();
  for (const action of actions) counts.set(action, (counts.get(action) ?? 0) + 1);
  return [...counts].map(([action, count]) => `${count} ${action.replace(/-/g, " ")}`).join(", ");
}

function printReport(ctx: Context, report: InstallReport, dryRun: boolean): void {
  const home = homeDirectory(ctx.env) || homedir();
  ctx.out(`${dryRun ? "Would install" : "Skills"} (${report.skills.length}) → ${tilde(report.canonicalDir, home)}: ${summarize(report.skills.map((s) => s.action))}`);
  for (const harness of report.harnesses)
    ctx.out(`  ${harness.id.padEnd(15)} ${tilde(harness.skillsDir, home).padEnd(28)} ${summarize(harness.links.map((l) => l.action))}`);
  if (!report.harnesses.length)
    ctx.out("  No coding agent was found in this home directory; agents that read ~/.agents/skills will find the skill there.");
  const kept = [
    ...report.skills.filter((s) => s.action.startsWith("kept")).map((s) => `${s.name} (${s.action === "kept-changed" ? "changed since it was installed" : "installed by another source"})`),
    ...report.harnesses.flatMap((h) => h.links.filter((l) => l.action.startsWith("kept")).map((l) => `${h.id}/${l.name}`)),
  ];
  if (kept.length) ctx.out(`Kept as they are: ${kept.join(", ")}. Run with --force to replace them.`);
  if (report.notInstalled.length) ctx.out(`Not installed here, so nothing was written for: ${report.notInstalled.join(", ")}.`);
  if (report.lockNote) ctx.out(report.lockNote);
}

export async function init(ctx: Context, flags: Record<string, unknown>): Promise<number> {
  const dryRun = Boolean(flags["dry-run"]);
  const agents = flags.agent as string[] | undefined;
  const known = harnesses(ctx.env).map((h) => h.id);
  const unknown = (agents ?? []).filter((id) => !known.includes(id));
  if (unknown.length) {
    ctx.err(`Unknown agent ${unknown.join(", ")}. Known agents: ${known.join(", ")}.`);
    return 1;
  }

  let report: InstallReport;
  try {
    const plan = installSkills({ env: ctx.env, bundleDir: BUNDLE_DIR, agents, force: Boolean(flags.force), dryRun: true, now: ctx.io.now(), platform: ctx.io.platform });
    if (!plan.skills.length) {
      ctx.err("This build of trendsfast carries no skills; reinstall it with npx -y trendsfast-cli@latest init.");
      return 1;
    }
    if (!dryRun && interactive(ctx.io) && !flags.yes && !flags.all) {
      const targets = ["~/.agents/skills", ...plan.harnesses.map((h) => h.id)].join(", ");
      const count = plan.skills.length === 1 ? "the TrendsFast skill" : `${plan.skills.length} TrendsFast skills`;
      if (!(await confirm(ctx.io, `Install ${count} into ${targets}?`))) {
        ctx.err("Nothing was installed.");
        return 1;
      }
    }
    report = dryRun ? plan : installSkills({ env: ctx.env, bundleDir: BUNDLE_DIR, agents, force: Boolean(flags.force), now: ctx.io.now(), platform: ctx.io.platform });
  } catch (error) {
    ctx.err(`The skill could not be installed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  printReport(ctx, report, dryRun);
  if (dryRun) return 0;

  // Sign in, unless asked not to or a key is already here.
  let code = 0;
  const client = ctx.client();
  if (!flags["no-login"] && !client.hasApiKey) {
    let base: string;
    try {
      base = normalizeBaseUrl(ctx.loginBaseUrl());
    } catch (error) {
      return failure(ctx, error);
    }
    const preflight = await loginPreflight(base, ctx.fetch, ctx.userAgent);
    if (preflight.kind === "enabled") code = await login(ctx, flags);
    else if (preflight.kind === "unavailable")
      ctx.out(`Browser sign-in is not available yet. Create a key at ${API_KEYS_URL}, then run \`trendsfast login --paste\` in your own terminal.`);
    else ctx.err(`Could not reach ${base} to sign in (${preflight.detail}); run \`trendsfast login\` later.`);
  } else if (client.hasApiKey) ctx.out("Already signed in.");

  // Check with free reads only.
  const signedIn = ctx.client();
  if (signedIn.hasApiKey) {
    try {
      const wallet = await signedIn.wallet();
      const { context } = await signedIn.context();
      ctx.out(
        `Verified with free reads: ${creditsLabel(wallet.available)} available; ${context?.kind === "CONFIRMED_CONTEXT" ? `brand context confirmed (revision ${context.revision})` : "no confirmed brand context yet: add your brand at https://trendsfast.com/dashboard before running a product"}.`,
      );
    } catch (error) {
      code = code || failure(ctx, error);
    }
  } else if (!flags["no-login"]) ctx.out("After signing in, run `trendsfast whoami` to confirm.");

  const detected = installedHarnesses(ctx.env).map((h) => h.id).filter((id) => MCP_SNIPPETS[id]);
  if (detected.length) {
    ctx.out("\nOptional: also connect the MCP server. The skill and this CLI work without it; each line reads the key from TRENDSFAST_API_KEY in that client's environment.");
    for (const id of detected) ctx.out(`\n${MCP_SNIPPETS[id]!.name}:\n${MCP_SNIPPETS[id]!.snippet}`);
  }
  ctx.out("\nNext: ask your agent about your market, or try `trendsfast quote customers` (free) and `trendsfast customers --max-credits 10`.");
  return code;
}
