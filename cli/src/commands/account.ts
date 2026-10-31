/** The free reads: who am I, my brand, my balance, a price, my history, a saved result. */
import { UsageError } from "../args.js";
import type { Context } from "../context.js";
import { formatContext, formatHistory, formatQuote, formatWallet } from "../format.js";
import { readJournal, updateJournal } from "../journal.js";
import { effectiveLoginStatus } from "../login/state.js";
import { OPERATIONS, READ_CREDITS, UUID_PATTERN, creditsLabel, findProduct, type Operation } from "../sdk/catalog.js";
import { credentialsPath, keyPrefix, readStoredCredentials } from "../sdk/credentials.js";
import { TrendsFastError } from "../sdk/errors.js";
import { emitResult } from "./query.js";
import { failure, outputFormat, printJson, writeOutput } from "./shared.js";

async function read<T>(
  ctx: Context,
  flags: Record<string, unknown>,
  load: () => Promise<T>,
  text: (value: T) => string,
  label: string,
): Promise<number> {
  try {
    const format = outputFormat(flags);
    const value = await load();
    writeOutput(ctx, flags, value, label, label);
    if (format === "text") ctx.out(text(value));
    else printJson(ctx, value);
    return 0;
  } catch (error) {
    return failure(ctx, error);
  }
}

export const context = (ctx: Context, flags: Record<string, unknown>) =>
  read(ctx, flags, () => ctx.client().context(), formatContext, "context");

export const credits = (ctx: Context, flags: Record<string, unknown>) =>
  read(ctx, flags, () => ctx.client().wallet(), formatWallet, "credits");

export const history = (ctx: Context, flags: Record<string, unknown>) =>
  read(ctx, flags, () => ctx.client().history(flags.cursor as string | undefined), formatHistory, "history");

/** What a command costs: `quote customers`, `quote trending`, `quote global`, `quote niche`. */
export function quoteTarget(name: string | undefined): { operation: Operation; product?: ReturnType<typeof findProduct>; label: string } {
  if (!name) throw new UsageError("Name the command to price: trendsfast quote <customers|trending|competitors|formats|search|global|niche|ask|discover>");
  const product = findProduct(name);
  if (product && (name === product.command || name !== "niche"))
    return { operation: "niche", product, label: `${product.name} (${product.command})` };
  if ((OPERATIONS as readonly string[]).includes(name)) return { operation: name as Operation, label: name };
  throw new UsageError(`Nothing called "${name}" has a price. Use customers, trending, competitors, formats, search, global, niche, ask or discover.`);
}

export async function quote(ctx: Context, flags: Record<string, unknown>, positionals: string[]): Promise<number> {
  try {
    const target = quoteTarget(positionals[0]);
    return read(ctx, flags, () => ctx.client().quote(target.operation, target.product?.id), (value) => formatQuote(value, target.label), "quote");
  } catch (error) {
    return failure(ctx, error);
  }
}

export async function result(ctx: Context, flags: Record<string, unknown>, positionals: string[]): Promise<number> {
  const id = positionals[0];
  if (!id || !UUID_PATTERN.test(id)) return failure(ctx, new UsageError("Give the result ID: trendsfast result <result_id> [--cursor <next_cursor>]"));
  try {
    const value = await ctx.client().result(id, flags.cursor as string | undefined);
    emitResult(ctx, flags, value, `Saved result ${value.result_id}`, "result");
    ctx.err(`result_id ${value.result_id} · request_id ${value.request_id} · free read`);
    return 0;
  } catch (error) {
    return failure(ctx, error);
  }
}

export async function request(ctx: Context, flags: Record<string, unknown>, positionals: string[]): Promise<number> {
  const id = positionals[0];
  if (!id || !UUID_PATTERN.test(id)) return failure(ctx, new UsageError("Give the request ID: trendsfast request <request_id>"));
  const journal = readJournal(ctx.env, id);
  try {
    const value = await ctx.client().recover(id);
    if (journal)
      updateJournal(ctx.env, id, { status: "completed", result_id: value.result_id, credits_charged: value.usage.credits_charged }, ctx.io.now());
    emitResult(ctx, flags, value, `Request ${id}`, "request");
    ctx.err(`request_id ${id} · result_id ${value.result_id} · charged ${creditsLabel(value.usage.credits_charged)} when it ran · this read is free`);
    return 0;
  } catch (error) {
    if (error instanceof TrendsFastError && error.code === "NOT_FOUND" && journal)
      ctx.err(`This machine sent it at ${journal.created_at} (${journal.command}, max ${journal.max_credits} credits).`);
    return failure(ctx, error);
  }
}

export async function whoami(ctx: Context, flags: Record<string, unknown>): Promise<number> {
  const path = credentialsPath(ctx.env);
  const stored = readStoredCredentials(path);
  const client = ctx.client();
  const json = outputFormat(flags) !== "text";
  if (!client.hasApiKey) {
    const status = effectiveLoginStatus(ctx.env, ctx.io.now());
    const waiting = status?.status === "waiting";
    if (json) printJson(ctx, { signed_in: false, login: status ? { status: status.status, mode: status.mode, expires_at: status.expires_at } : null });
    else
      ctx.out(
        waiting
          ? status!.mode === "code"
            ? "Not signed in yet: a sign-in is waiting for its code. Finish with `trendsfast login --code <code>`."
            : `Not signed in yet: a sign-in is waiting in the browser until ${status!.expires_at.slice(11, 16)} UTC. Run \`trendsfast whoami\` again after finishing it.`
          : status && status.status !== "signed_in"
            ? `Not signed in: the last sign-in was ${status.status}. Run \`trendsfast login --background\` and finish in the browser.`
            : "Not signed in. Run `trendsfast login --background` and finish in the browser, or set TRENDSFAST_API_KEY.",
      );
    return 2;
  }
  const fromEnv = client.keySource === "env";
  const key = fromEnv ? (ctx.env.TRENDSFAST_API_KEY ?? "").trim() : (stored?.api_key ?? "");
  const info = {
    signed_in: true,
    key_source: client.keySource,
    key_prefix: keyPrefix(key),
    project_id: fromEnv ? null : (stored?.project_id ?? null),
    project_name: fromEnv ? null : (stored?.project_name ?? null),
    expires_at: fromEnv ? null : (stored?.expires_at ?? null),
    base_url: client.baseUrl,
    credentials_path: fromEnv ? null : path,
    balance: null as number | null,
  };
  let code = 0;
  let problem = "";
  try {
    info.balance = (await client.wallet()).available;
  } catch (error) {
    code = error instanceof TrendsFastError ? error.exitCode : 7;
    problem = error instanceof TrendsFastError ? `${error.code}: ${error.message}` : String(error);
    if (error instanceof TrendsFastError && error.kind === "auth" && error.status === 403) code = 0;
  }
  if (json) printJson(ctx, { ...info, problem: problem || null });
  else {
    ctx.out(
      [
        `Project: ${info.project_name ? `${info.project_name}${info.project_id ? ` (${info.project_id})` : ""}` : fromEnv ? "unknown (the key comes from TRENDSFAST_API_KEY)" : "unknown (a pasted key)"}`,
        `Key: ${info.key_prefix} · ${fromEnv ? "from TRENDSFAST_API_KEY" : `stored in ${path}`}${info.expires_at ? ` · expires ${info.expires_at.slice(0, 10)}` : ""}`,
        `Balance: ${info.balance === null ? "unknown" : creditsLabel(info.balance)}`,
        `Base URL: ${info.base_url}`,
      ].join("\n"),
    );
  }
  if (problem) ctx.err(problem);
  return code;
}

/** For `trendsfast quote` with no product: the plain read prices, from the catalog. */
export function readPrices(): string {
  return (Object.keys(READ_CREDITS) as Operation[]).map((op) => `${op} ${creditsLabel(READ_CREDITS[op])}`).join(", ");
}
