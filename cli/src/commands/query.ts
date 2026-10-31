/**
 * The paid commands: the five products and the cheaper index reads.
 *
 * Every one follows the same contract. The free quote is printed to stderr first. Without a
 * terminal (an agent or a script) the command needs `--max-credits` at or above the quote,
 * or it exits 1 and names the price; at a terminal it asks unless `--yes`. The request ID is
 * written to disk before anything is sent, a lost answer is retried with that same ID and
 * read back once, and an outcome that is still unknown exits 6 with `trendsfast request <id>`.
 * It never sends the call again under a new ID.
 */
import { randomUUID } from "node:crypto";
import { UsageError, type FlagSpec } from "../args.js";
import type { Context } from "../context.js";
import { formatResult } from "../format.js";
import { interactive } from "../io.js";
import { writeJournal, updateJournal } from "../journal.js";
import { confirm } from "../login/paste.js";
import {
  CATEGORIES,
  CONTENT_TYPES,
  DISCOVER_CHANNELS,
  DISCOVER_SCOPES,
  EVIDENCE_QUALITIES,
  FILTER_LIMITS,
  MAX_CREDITS_CEILING,
  PLATFORMS,
  PRODUCTS,
  READ_CREDITS,
  SIGNALS,
  UUID_PATTERN,
  creditsLabel,
  type Operation,
  type Product,
  type ProductId,
} from "../sdk/catalog.js";
import type { TrendsFast } from "../sdk/client.js";
import { compactResult } from "../sdk/compact.js";
import { AuthRequiredError, ProductRequiresContextError, TrendsFastError } from "../sdk/errors.js";
import type { TrendsResult } from "../sdk/types.js";
import { OUTPUT_FLAGS, failure, outputFormat, printJson, writeOutput } from "./shared.js";

export const FILTER_FLAGS: FlagSpec[] = [
  { name: "lookback-hours", type: "number", value: "<1-720>", help: "How far back to read (lookback_hours; server default 72)" },
  { name: "observed-from", type: "string", value: "<iso-time>", help: "Window start (observed_from), e.g. 2026-10-01T00:00:00Z" },
  { name: "observed-to", type: "string", value: "<iso-time>", help: "Window end (observed_to)" },
  { name: "platforms", type: "list", value: "<list>", help: `Only these platforms: ${PLATFORMS.join(", ")}` },
  { name: "content-types", type: "list", value: "<list>", help: `Only these content types: ${CONTENT_TYPES.join(", ")}` },
  { name: "categories", type: "list", value: "<list>", help: "Only these categories, e.g. MARKETING,SOFTWARE_DEVELOPMENT" },
  { name: "signals", type: "list", value: "<list>", help: `Only these signals: ${SIGNALS.join(", ")}` },
  { name: "evidence-quality", type: "list", value: "<list>", help: `Only these: ${EVIDENCE_QUALITIES.join(", ")}` },
  { name: "country", type: "string", value: "<XX>", help: "Two-letter country the source states, e.g. US" },
  { name: "observed-market", type: "string", value: "<XX>", help: "Two-letter market whose chart or feed it came from" },
  { name: "language", type: "string", value: "<xx>", help: "Language, e.g. en or en-US" },
  { name: "region", type: "string", value: "<text>", help: "Region the source states" },
  { name: "history-days", type: "number", value: "<1-90>", help: "Days of history to compare (history_days)" },
  { name: "compare-to", type: "string", value: "<iso-time>", help: "Comparison baseline (compare_to)" },
  { name: "limit", type: "number", value: "<1-100>", help: "Items per page (server default 20)" },
];

export const CALL_FLAGS: FlagSpec[] = [
  { name: "max-credits", type: "number", value: "<n>", help: "The most this call may cost; required without a terminal" },
  { name: "request-id", type: "string", value: "<uuid>", help: "Reuse a request ID, e.g. after exit code 6 found no record" },
  { name: "yes", short: "y", type: "boolean", help: "Do not ask before spending credits at a terminal" },
  { name: "dry-run", type: "boolean", help: "Show the quote and the request without sending the paid call" },
];

const BRAND_FLAGS: FlagSpec[] = [
  { name: "context-id", type: "string", value: "<uuid>", help: "The brand context to use (default: read for free from `trendsfast context`)" },
  { name: "no-adjacent", type: "boolean", help: "Leave out the niches next to yours (include_adjacent false)" },
  { name: "no-global", type: "boolean", help: "Leave out the global ring (include_global false)" },
];

const NICHE_FIELDS: FlagSpec[] = [
  { name: "url", type: "string", value: "<https-url>", help: "The niche's website" },
  { name: "keywords", type: "list", value: "<list>", help: "Search phrases the audience types" },
  { name: "competitors", type: "list", value: "<list>", help: "Competitor names" },
  { name: "competitor-handles", type: "list", value: "<list>", help: "Exact public handles of competitors" },
  { name: "competitor-domains", type: "list", value: "<list>", help: "Competitor web domains" },
  { name: "communities", type: "list", value: "<list>", help: "Where the audience gathers, e.g. r/SaaS" },
  { name: "topics", type: "list", value: "<list>", help: "Topics the niche is about" },
  { name: "problems", type: "list", value: "<list>", help: "Problems it solves" },
  { name: "audiences", type: "list", value: "<list>", help: "Who it serves" },
  { name: "exclusions", type: "list", value: "<list>", help: "Topics to leave out" },
];

export const PRODUCT_FLAGS: FlagSpec[] = [...BRAND_FLAGS, ...FILTER_FLAGS, ...CALL_FLAGS, ...OUTPUT_FLAGS];
export const GLOBAL_FLAGS: FlagSpec[] = [...FILTER_FLAGS, ...CALL_FLAGS, ...OUTPUT_FLAGS];
export const NICHE_FLAGS: FlagSpec[] = [
  { name: "brand", type: "boolean", help: "Rank against your confirmed brand context instead of a description" },
  ...NICHE_FIELDS,
  ...BRAND_FLAGS,
  ...FILTER_FLAGS,
  ...CALL_FLAGS,
  ...OUTPUT_FLAGS,
];
export const ASK_FLAGS: FlagSpec[] = [
  { name: "brand", type: "boolean", help: "Answer against your confirmed brand context" },
  { name: "niche", type: "string", value: "<description>", help: "Answer against a niche you describe" },
  ...NICHE_FIELDS,
  ...BRAND_FLAGS,
  ...FILTER_FLAGS,
  ...CALL_FLAGS,
  ...OUTPUT_FLAGS,
];
export const DISCOVER_FLAGS: FlagSpec[] = [
  { name: "scope", type: "list", value: "<list>", help: `Rings to read: ${DISCOVER_SCOPES.join(", ")} (default all)` },
  { name: "channels", type: "list", value: "<list>", help: `Channels: ${DISCOVER_CHANNELS.join(", ")} (default all)` },
  ...ASK_FLAGS,
];

function oneOf(values: readonly string[], given: string[], flag: string, upper = true): string[] {
  const normalized = given.map((value) => (upper ? value.toUpperCase() : value.toLowerCase()));
  const wrong = normalized.filter((value) => !values.includes(value));
  if (wrong.length) throw new UsageError(`--${flag} does not know ${wrong.join(", ")}. Use: ${values.join(", ")}.`);
  return normalized;
}

function bounded(flag: string, value: unknown, limits: { min: number; max: number }): number | undefined {
  if (value === undefined) return undefined;
  const number = value as number;
  if (number < limits.min || number > limits.max) throw new UsageError(`--${flag} must be ${limits.min} to ${limits.max}.`);
  return number;
}

/** The filters the flags set, under the API's own names; undefined when none is set. */
export function filtersFromFlags(flags: Record<string, unknown>): Record<string, unknown> | undefined {
  const filters: Record<string, unknown> = {};
  const list = (name: string) => flags[name] as string[] | undefined;
  if (list("platforms")) filters.platforms = oneOf(PLATFORMS, list("platforms")!, "platforms");
  if (list("content-types")) filters.content_types = oneOf(CONTENT_TYPES, list("content-types")!, "content-types");
  if (list("categories")) filters.categories = oneOf(CATEGORIES, list("categories")!, "categories");
  if (list("signals")) filters.signals = oneOf(SIGNALS, list("signals")!, "signals");
  if (list("evidence-quality")) filters.evidence_quality = oneOf(EVIDENCE_QUALITIES, list("evidence-quality")!, "evidence-quality");
  for (const [flag, key] of [
    ["country", "country"],
    ["observed-market", "observed_market"],
    ["language", "language"],
    ["region", "region"],
    ["observed-from", "observed_from"],
    ["observed-to", "observed_to"],
    ["compare-to", "compare_to"],
  ] as const)
    if (typeof flags[flag] === "string") filters[key] = flags[flag];
  const lookback = bounded("lookback-hours", flags["lookback-hours"], FILTER_LIMITS.lookback_hours);
  if (lookback !== undefined) filters.lookback_hours = lookback;
  const history = bounded("history-days", flags["history-days"], FILTER_LIMITS.history_days);
  if (history !== undefined) filters.history_days = history;
  const limit = bounded("limit", flags.limit, FILTER_LIMITS.limit);
  if (limit !== undefined) filters.limit = limit;
  return Object.keys(filters).length ? filters : undefined;
}

function ringFlags(flags: Record<string, unknown>) {
  return {
    ...(flags["no-adjacent"] ? { include_adjacent: false } : {}),
    ...(flags["no-global"] ? { include_global: false } : {}),
  };
}

function nicheFromFlags(description: string, flags: Record<string, unknown>): Record<string, unknown> {
  const niche: Record<string, unknown> = { description };
  if (typeof flags.url === "string") niche.url = flags.url;
  for (const [flag, key] of [
    ["keywords", "keywords"],
    ["competitors", "competitors"],
    ["competitor-handles", "competitor_handles"],
    ["competitor-domains", "competitor_domains"],
    ["communities", "communities"],
    ["topics", "topics"],
    ["problems", "problems"],
    ["audiences", "audiences"],
    ["exclusions", "exclusions"],
  ] as const)
    if (Array.isArray(flags[flag])) niche[key] = flags[flag];
  return niche;
}

/** The brand's confirmed context id: the flag, or a free read of `context`. */
async function brandContext(client: TrendsFast, flags: Record<string, unknown>): Promise<string> {
  if (typeof flags["context-id"] === "string") {
    if (!UUID_PATTERN.test(flags["context-id"])) throw new UsageError("--context-id must be a UUID.");
    return flags["context-id"];
  }
  const { context } = await client.context();
  if (!context || context.kind !== "CONFIRMED_CONTEXT" || !context.context_id)
    throw new ProductRequiresContextError(
      "PRODUCT_REQUIRES_CONTEXT",
      'This project has no confirmed brand context yet, and products run on it. Confirm your brand at https://trendsfast.com/dashboard, or read a niche you describe: trendsfast niche "<description>" (3 credits).',
      "usage",
    );
  return context.context_id;
}

interface Plan {
  command: string;
  label: string;
  operation: Operation;
  product?: ProductId;
  catalogPrice: number;
  input(client: TrendsFast): Promise<Record<string, unknown>>;
}

export function productPlan(product: Product, flags: Record<string, unknown>): Plan {
  return {
    command: product.command,
    label: `${product.name} (${product.command})`,
    operation: "niche",
    product: product.id,
    catalogPrice: product.credits,
    input: async (client) => {
      const filters = filtersFromFlags(flags);
      return { product: product.id, context_id: await brandContext(client, flags), ...(filters ? { filters } : {}), ...ringFlags(flags) };
    },
  };
}

export function readPlan(operation: Exclude<Operation, never>, positionals: string[], flags: Record<string, unknown>): Plan {
  const text = positionals.join(" ").trim();
  const plan = (input: Plan["input"]): Plan => ({
    command: operation,
    label: operation,
    operation,
    catalogPrice: READ_CREDITS[operation],
    input,
  });
  const filters = () => filtersFromFlags(flags);
  const scope = async (client: TrendsFast) => {
    if (flags.brand || typeof flags["context-id"] === "string") return { context_id: await brandContext(client, flags) };
    if (typeof flags.niche === "string") return { niche: nicheFromFlags(flags.niche, flags) };
    return {};
  };
  switch (operation) {
    case "global":
      if (text) throw new UsageError("`trendsfast global` takes no text; use `trendsfast ask \"<question>\"` for a question.");
      return plan(async () => ({ ...filters() }));
    case "niche":
      if (!text && !flags.brand && typeof flags["context-id"] !== "string")
        throw new UsageError('Describe the niche, or rank against your brand: trendsfast niche "<description>" | trendsfast niche --brand');
      return plan(async (client) => {
        const f = filters();
        const target = text ? { niche: nicheFromFlags(text, flags) } : { context_id: await brandContext(client, flags) };
        return { ...target, ...(f ? { filters: f } : {}), ...ringFlags(flags) };
      });
    case "ask":
      if (text.length < 3) throw new UsageError('Ask one question of at least 3 characters: trendsfast ask "<question>"');
      return plan(async (client) => {
        const f = filters();
        return { question: text, ...(await scope(client)), ...(f ? { filters: f } : {}), ...ringFlags(flags) };
      });
    case "discover":
      if (text && text.length < 3) throw new UsageError("A discover question needs at least 3 characters.");
      return plan(async (client) => {
        const f = filters();
        return {
          ...(text ? { question: text } : {}),
          ...(Array.isArray(flags.scope) ? { scope: oneOf(DISCOVER_SCOPES, flags.scope as string[], "scope", false) } : {}),
          ...(Array.isArray(flags.channels) ? { channels: oneOf(DISCOVER_CHANNELS, flags.channels as string[], "channels", false) } : {}),
          ...(await scope(client)),
          ...(f ? { filters: f } : {}),
          ...ringFlags(flags),
        };
      });
  }
}

/** Prints a result: the summary (or JSON) on stdout, the full response to -o, receipts on stderr. */
export function emitResult(ctx: Context, flags: Record<string, unknown>, result: TrendsResult, label: string, fileLabel: string): void {
  const format = outputFormat(flags);
  writeOutput(ctx, flags, result, fileLabel, result.result_id);
  if (format === "full") printJson(ctx, result);
  else if (format === "json") printJson(ctx, compactResult(result));
  else ctx.out(formatResult(compactResult(result), label));
}

export async function runPaid(ctx: Context, plan: Plan, flags: Record<string, unknown>, argv: readonly string[]): Promise<number> {
  try {
    outputFormat(flags);
    const client = ctx.client();
    if (!client.hasApiKey && !flags["dry-run"])
      throw new AuthRequiredError(
        "AUTH_REQUIRED",
        "Not signed in. Run `trendsfast login --background` and finish in the browser, or set TRENDSFAST_API_KEY. Nothing was sent.",
        "auth",
      );
    let price = plan.catalogPrice;
    let live = false;
    if (client.hasApiKey) {
      try {
        price = (await client.quote(plan.operation, plan.product)).credits;
        live = true;
      } catch (error) {
        if (error instanceof TrendsFastError && (error.kind === "auth" || error.kind === "usage")) return failure(ctx, error);
      }
    }
    ctx.err(`Quote: ${plan.label} costs ${creditsLabel(price)}${live ? "" : " (catalog price; the live quote was not read)"}.`);

    const max = flags["max-credits"] as number | undefined;
    if (max !== undefined && (max < 0 || max > MAX_CREDITS_CEILING)) throw new UsageError(`--max-credits must be 0 to ${MAX_CREDITS_CEILING}.`);
    if (max !== undefined && max < price) {
      ctx.err(`--max-credits ${max} is below the price of ${creditsLabel(price)}; nothing was sent.`);
      return 3;
    }
    const tty = interactive(ctx.io);
    if (max === undefined && !tty && !flags["dry-run"]) {
      ctx.err(
        `Paid commands run without a terminal need --max-credits. This one costs ${creditsLabel(price)}:\n  trendsfast ${[...argv, "--max-credits", String(price)].join(" ")}`,
      );
      return 1;
    }
    const maxCredits = max ?? price;
    const requestId = typeof flags["request-id"] === "string" ? flags["request-id"] : randomUUID();
    if (!UUID_PATTERN.test(requestId)) throw new UsageError("--request-id must be a UUID.");

    if (flags["dry-run"]) {
      const input = client.hasApiKey
        ? await plan.input(client)
        : { note: "Sign in to see the exact input: product calls read your brand's context_id for free first." };
      ctx.err("Dry run: nothing was sent.");
      printJson(ctx, {
        method: "POST",
        url: `${client.baseUrl}/v3/trends/${plan.operation}`,
        headers: { authorization: "Bearer <your key>", "content-type": "application/json" },
        body: { request_id: requestId, max_credits: maxCredits, input },
        quote: { credits: price, live },
      });
      return 0;
    }
    const input = await plan.input(client);
    if (tty && !flags.yes && !(await confirm(ctx.io, `Run ${plan.label} for ${creditsLabel(price)}?`))) {
      ctx.err("Nothing was sent.");
      return 1;
    }

    const now = ctx.io.now().toISOString();
    writeJournal(ctx.env, {
      version: 1,
      request_id: requestId,
      command: plan.command,
      operation: plan.operation,
      product: plan.product ?? null,
      max_credits: maxCredits,
      base_url: client.baseUrl,
      created_at: now,
      updated_at: now,
      status: "sending",
    });
    ctx.err(`request_id ${requestId}`);
    let result: TrendsResult;
    try {
      result = await client.query(plan.operation, input, { request_id: requestId, max_credits: maxCredits });
    } catch (error) {
      const unconfirmed = error instanceof TrendsFastError && error.kind === "unconfirmed";
      updateJournal(
        ctx.env,
        requestId,
        { status: unconfirmed ? "unconfirmed" : "refused", error: error instanceof TrendsFastError ? error.code : "ERROR" },
        ctx.io.now(),
      );
      return failure(ctx, error);
    }
    updateJournal(
      ctx.env,
      requestId,
      { status: "completed", result_id: result.result_id, credits_charged: result.usage.credits_charged, replayed: result.usage.replayed },
      ctx.io.now(),
    );
    emitResult(ctx, flags, result, plan.label, plan.command);
    let balance = "";
    try {
      balance = ` · balance ${creditsLabel((await client.wallet()).available)}`;
    } catch {
      balance = "";
    }
    const charged = result.usage.replayed
      ? `charged 0 credits now (replayed; ${result.usage.credits_charged} when it first ran)`
      : `charged ${creditsLabel(result.usage.this_request_credits)}`;
    ctx.err(`request_id ${result.request_id} · result_id ${result.result_id} · ${charged}${balance}`);
    return 0;
  } catch (error) {
    return failure(ctx, error);
  }
}

export function productByCommand(command: string): Product | undefined {
  return PRODUCTS.find((product) => product.command === command);
}
