/** `trendsfast doctor`: every check with its result and, where one fails, the fix. Free. */
import { statSync } from "node:fs";
import type { Context } from "../context.js";
import { effectiveLoginStatus } from "../login/state.js";
import { loginPreflight } from "../login/preflight.js";
import { API_KEY_PATTERN, creditsLabel } from "../sdk/catalog.js";
import { credentialsPath, keyPrefix, readStoredCredentials } from "../sdk/credentials.js";
import { TrendsFastError } from "../sdk/errors.js";
import { installSkills } from "../skills/install.js";
import { CLI_VERSION } from "../version.js";
import { BUNDLE_DIR } from "./init.js";
import { outputFormat, printJson } from "./shared.js";

type Status = "pass" | "warn" | "fail";
interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
  exit?: number;
}

export async function doctor(ctx: Context, flags: Record<string, unknown>): Promise<number> {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);
  const major = Number(process.versions.node.split(".")[0]);
  add(
    major >= 20
      ? { name: "node", status: "pass", detail: `Node ${process.versions.node}` }
      : { name: "node", status: "fail", detail: `Node ${process.versions.node}`, fix: "Install Node.js 20 or newer.", exit: 1 },
  );
  add({ name: "cli", status: "pass", detail: `trendsfast-cli ${CLI_VERSION}` });

  const path = credentialsPath(ctx.env);
  const stored = readStoredCredentials(path);
  const client = ctx.client();
  const envKey = ctx.env.TRENDSFAST_API_KEY?.trim();
  if (!client.hasApiKey) {
    const status = effectiveLoginStatus(ctx.env, ctx.io.now());
    add({
      name: "credentials",
      status: "fail",
      detail: status?.status === "waiting" ? "no key yet; a sign-in is waiting" : "no key",
      fix: status?.status === "waiting" ? "Finish signing in in the browser, then run trendsfast whoami." : "Run trendsfast login --background and finish in the browser.",
      exit: 2,
    });
  } else {
    const key = client.keySource === "env" ? envKey! : stored!.api_key;
    const source = client.keySource === "env" ? "TRENDSFAST_API_KEY" : path;
    if (!API_KEY_PATTERN.test(key))
      add({ name: "credentials", status: "fail", detail: `the key from ${source} is not a TrendsFast key`, fix: "Run trendsfast login.", exit: 2 });
    else {
      let detail = `${keyPrefix(key)} from ${source}`;
      let status: Status = "pass";
      let fix: string | undefined;
      if (client.keySource === "stored") {
        try {
          const mode = statSync(path).mode & 0o777;
          if (process.platform !== "win32" && mode & 0o077) {
            status = "warn";
            fix = `chmod 600 ${path}`;
            detail += ` (readable by others: ${mode.toString(8)})`;
          }
        } catch {
          // Read a moment ago; nothing to add.
        }
        const expires = stored?.expires_at ? Date.parse(stored.expires_at) : NaN;
        if (!Number.isNaN(expires)) {
          const days = Math.floor((expires - ctx.io.now().getTime()) / 86_400_000);
          if (days < 0) {
            status = "fail";
            fix = "The key expired: run trendsfast login.";
          } else if (days < 7 && status === "pass") {
            status = "warn";
            fix = "The key expires within a week: run trendsfast login to replace it.";
          }
          detail += ` · expires ${stored!.expires_at!.slice(0, 10)}`;
        }
      }
      add({ name: "credentials", status, detail, ...(fix ? { fix } : {}), ...(status === "fail" ? { exit: 2 } : {}) });
    }
  }

  if (client.hasApiKey) {
    try {
      const wallet = await client.wallet();
      add({ name: "api", status: "pass", detail: `${client.baseUrl} accepts the key · ${creditsLabel(wallet.available)} available` });
      const { context } = await client.context();
      add(
        context?.kind === "CONFIRMED_CONTEXT"
          ? { name: "brand", status: "pass", detail: `confirmed context ${context.context_id} (revision ${context.revision})` }
          : { name: "brand", status: "warn", detail: "no confirmed brand context", fix: "Add and confirm your brand at https://trendsfast.com/dashboard; product commands need it." },
      );
    } catch (error) {
      const e = error instanceof TrendsFastError ? error : null;
      add({
        name: "api",
        status: e?.status === 403 ? "warn" : "fail",
        detail: e ? `${e.code}: ${e.message}` : String(error),
        fix: e?.kind === "auth" ? "Run trendsfast login to get a key with all three scopes." : "Check your connection and the base URL (TRENDSFAST_BASE_URL or --base-url).",
        ...(e?.status === 403 ? {} : { exit: e?.exitCode ?? 7 }),
      });
    }
  } else {
    const preflight = await loginPreflight(client.baseUrl, ctx.fetch, ctx.userAgent);
    add(
      preflight.kind === "unreachable"
        ? { name: "api", status: "fail", detail: `${client.baseUrl} unreachable (${preflight.detail})`, fix: "Check your connection and the base URL.", exit: 7 }
        : { name: "api", status: "pass", detail: `${client.baseUrl} reachable · browser sign-in ${preflight.kind === "enabled" ? "available" : "not available yet (use trendsfast login --paste)"}` },
    );
  }

  const report = installSkills({ env: ctx.env, bundleDir: BUNDLE_DIR, dryRun: true, now: ctx.io.now(), platform: ctx.io.platform });
  const missing = report.skills.filter((skill) => skill.action === "installed" || skill.action === "updated").map((s) => s.name);
  add(
    missing.length
      ? { name: "skills", status: "warn", detail: `${missing.join(", ")} missing or outdated in ${report.canonicalDir}`, fix: "Run trendsfast init." }
      : { name: "skills", status: "pass", detail: `${report.skills.map((s) => s.name).join(", ")} in ${report.canonicalDir}` },
  );
  for (const harness of report.harnesses) {
    const todo = harness.links.filter((link) => link.action === "linked" || link.action === "replaced").length;
    add(
      todo
        ? { name: `agent ${harness.id}`, status: "warn", detail: `${todo} skill${todo === 1 ? "" : "s"} not linked in ${harness.skillsDir}`, fix: `Run trendsfast init --agent ${harness.id}.` }
        : { name: `agent ${harness.id}`, status: "pass", detail: `${harness.links.map((l) => l.name).join(", ")} linked in ${harness.skillsDir}` },
    );
  }
  if (!report.harnesses.length) add({ name: "agents", status: "warn", detail: "no coding agent found in this home directory", fix: "Install an agent, then run trendsfast init." });

  const failed = checks.find((check) => check.status === "fail");
  if (outputFormat(flags) !== "text") printJson(ctx, { ok: !failed, checks });
  else
    for (const check of checks)
      ctx.out(`${check.status === "pass" ? "ok  " : check.status === "warn" ? "warn" : "FAIL"}  ${check.name.padEnd(18)} ${check.detail}${check.fix ? `\n      fix: ${check.fix}` : ""}`);
  return failed ? (failed.exit ?? 1) : 0;
}
