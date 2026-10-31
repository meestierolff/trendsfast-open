/** Output and error handling every command shares. stdout carries data only; receipts,
 * progress and errors go to stderr, so `trendsfast … --json | jq` always parses. */
import { UsageError, type FlagSpec } from "../args.js";
import type { Context } from "../context.js";
import { generatedName, outputPath, writeJsonFile } from "../output.js";
import { TrendsFastError } from "../sdk/errors.js";

export const OUTPUT_FLAGS: FlagSpec[] = [
  { name: "json", type: "boolean", help: "Print compact JSON instead of the text summary" },
  { name: "format", type: "string", value: "<text|json|full>", help: "text (default), json (compact view) or full (the whole response)" },
  { name: "output", short: "o", type: "string", value: "<path>", help: "Also write the full response as JSON; a bare file name goes into .trendsfast/" },
];

export type Format = "text" | "json" | "full";

export function outputFormat(flags: Record<string, unknown>): Format {
  const format = flags.json ? "json" : ((flags.format as string | undefined) ?? "text");
  if (!["text", "json", "full"].includes(format)) throw new UsageError(`--format must be text, json or full, not "${format}".`);
  return format as Format;
}

/** JSON on stdout: indented for a person at a terminal, one line for a program. */
export function printJson(ctx: Context, value: unknown): void {
  ctx.out(ctx.io.stdout.isTTY ? JSON.stringify(value, null, 2) : JSON.stringify(value));
}

/** Writes the full response where -o asked, and says where on stderr. */
export function writeOutput(ctx: Context, flags: Record<string, unknown>, value: unknown, label: string, id: string): void {
  if (typeof flags.output !== "string") return;
  const path = outputPath(flags.output, ctx.io.cwd, generatedName(label, id, ctx.io.now()));
  writeJsonFile(path, value);
  ctx.err(`Full response written to ${path}`);
}

/** Reports a failure on stderr and returns the exit code it stands for. */
export function failure(ctx: Context, error: unknown): number {
  if (error instanceof UsageError) {
    ctx.err(error.message);
    return 1;
  }
  if (error instanceof TrendsFastError) {
    ctx.err(`Error (${error.code}): ${error.message}`);
    if (error.recovery && !error.message.includes(error.recovery)) ctx.err(error.recovery);
    if (error.retryAfterSeconds !== undefined) ctx.err(`retry_after ${error.retryAfterSeconds}s`);
    if (error.kind === "unconfirmed" && error.requestId && !error.message.includes("trendsfast request"))
      ctx.err(`Read the outcome with: trendsfast request ${error.requestId}`);
    return error.exitCode;
  }
  ctx.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
  return 7;
}
