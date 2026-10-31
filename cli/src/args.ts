/** A small, strict argument parser: an unknown flag is an error, never ignored, so an agent
 * that guesses a flag learns at once instead of running something it did not mean. */

export type FlagType = "boolean" | "string" | "number" | "list";

export interface FlagSpec {
  /** The long name, without dashes: `max-credits`. */
  name: string;
  short?: string;
  type: FlagType;
  /** One line for --help. */
  help: string;
  /** How the value reads in --help: `<n>`, `<uuid>`. */
  value?: string;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | number | boolean | string[]>;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv: readonly string[], specs: readonly FlagSpec[], command: string): ParsedArgs {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const byShort = new Map(specs.filter((spec) => spec.short).map((spec) => [spec.short!, spec]));
  const positionals: string[] = [];
  const flags: ParsedArgs["flags"] = {};
  const unknown = (flag: string) =>
    new UsageError(`Unknown option ${flag} for \`trendsfast ${command}\`. Run \`trendsfast ${command} --help\` for its options.`);

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    let spec: FlagSpec | undefined;
    let inline: string | undefined;
    let negated = false;
    if (token.startsWith("--")) {
      const [rawName, ...rest] = token.slice(2).split("=");
      inline = rest.length ? rest.join("=") : undefined;
      spec = byName.get(rawName!);
      if (!spec && rawName!.startsWith("no-")) {
        const positive = byName.get(rawName!.slice(3));
        if (positive?.type === "boolean") {
          spec = positive;
          negated = true;
        }
      }
      if (!spec) throw unknown(`--${rawName}`);
    } else {
      const short = token.slice(1);
      spec = byShort.get(short);
      if (!spec) throw unknown(token);
    }

    if (spec.type === "boolean") {
      if (inline !== undefined) {
        if (!["true", "false"].includes(inline)) throw new UsageError(`--${spec.name} takes no value.`);
        flags[spec.name] = inline === "true" && !negated;
      } else flags[spec.name] = !negated;
      continue;
    }
    if (negated) throw unknown(token);
    let value = inline;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-" && !/^-\d/.test(next)))
        throw new UsageError(`--${spec.name} needs a value${spec.value ? ` ${spec.value}` : ""}.`);
      value = next;
      index++;
    }
    if (spec.type === "number") {
      const number = Number(value);
      if (!/^-?\d+$/.test(value.trim()) || !Number.isSafeInteger(number))
        throw new UsageError(`--${spec.name} must be a whole number, not "${value}".`);
      flags[spec.name] = number;
    } else if (spec.type === "list") {
      const items = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      flags[spec.name] = [...((flags[spec.name] as string[] | undefined) ?? []), ...items];
    } else {
      flags[spec.name] = value;
    }
  }
  return { positionals, flags };
}

/** The --help lines for a set of flags, aligned. */
export function flagHelp(specs: readonly FlagSpec[]): string[] {
  const label = (spec: FlagSpec) =>
    `${spec.short ? `-${spec.short}, ` : "    "}--${spec.name}${spec.type === "boolean" ? "" : ` ${spec.value ?? "<value>"}`}`;
  const width = Math.min(34, Math.max(...specs.map((spec) => label(spec).length)) + 2);
  return specs.map((spec) => `  ${label(spec).padEnd(width)}${spec.help}`);
}
