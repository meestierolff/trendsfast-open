import { parseArgs, UsageError } from "./args.js";
import * as account from "./commands/account.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { login, logout } from "./commands/login.js";
import { productByCommand, productPlan, readPlan, runPaid } from "./commands/query.js";
import { failure } from "./commands/shared.js";
import { createContext } from "./context.js";
import { COMMANDS, commandHelp, mainHelp } from "./help.js";
import type { Io } from "./io.js";
import { LISTENER_COMMAND, runLoginListener } from "./login/background.js";
import { sweepExpiredPending } from "./login/state.js";
import type { Operation } from "./sdk/catalog.js";
import { CLI_VERSION } from "./version.js";

const NO_POSITIONALS = new Set(["init", "login", "logout", "whoami", "doctor", "context", "credits", "history", "global", "customers", "trending", "competitors", "formats", "search"]);

/** Runs one command and returns its exit code. Never calls process.exit, so tests can run it. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (command === LISTENER_COMMAND) {
    const at = (flag: string) => {
      const index = rest.indexOf(flag);
      return index >= 0 ? rest[index + 1] : undefined;
    };
    return runLoginListener({ baseUrl: at("--base-url") ?? "https://trendsfast.com", device: at("--device"), env: io.env });
  }
  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(mainHelp());
    return 0;
  }
  if (command === "help") {
    const help = rest[0] ? commandHelp(rest[0]) : mainHelp();
    io.stdout.write(help ?? mainHelp());
    return help ? 0 : 1;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    io.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }
  const spec = COMMANDS.find((entry) => entry.name === command);
  if (!spec) {
    io.stderr.write(`Unknown command "${command}". Run \`trendsfast --help\` for the commands.\n`);
    return 1;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout.write(commandHelp(command)!);
    return 0;
  }
  try {
    sweepExpiredPending(io.env, io.now());
  } catch {
    // A config directory that cannot be read is reported by the command that needs it.
  }
  let parsed;
  try {
    parsed = parseArgs(rest, spec.flags, command);
    if (NO_POSITIONALS.has(command) && parsed.positionals.length)
      throw new UsageError(`\`trendsfast ${command}\` takes no arguments (got "${parsed.positionals.join(" ")}"). Run \`trendsfast ${command} --help\`.`);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const { flags, positionals } = parsed;
  const ctx = createContext(io, typeof flags["base-url"] === "string" ? flags["base-url"] : undefined);
  try {
    switch (command) {
      case "init":
        return await init(ctx, flags);
      case "login":
        return await login(ctx, flags);
      case "logout":
        return logout(ctx);
      case "whoami":
        return await account.whoami(ctx, flags);
      case "doctor":
        return await doctor(ctx, flags);
      case "context":
        return await account.context(ctx, flags);
      case "credits":
        return await account.credits(ctx, flags);
      case "quote":
        return await account.quote(ctx, flags, positionals);
      case "history":
        return await account.history(ctx, flags);
      case "result":
        return await account.result(ctx, flags, positionals);
      case "request":
        return await account.request(ctx, flags, positionals);
      case "global":
      case "niche":
      case "ask":
      case "discover":
        return await runPaid(ctx, readPlan(command as Operation, positionals, flags), flags, argv);
      default: {
        const product = productByCommand(command);
        if (!product) throw new UsageError(`Unknown command "${command}".`);
        return await runPaid(ctx, productPlan(product, flags), flags, argv);
      }
    }
  } catch (error) {
    return failure(ctx, error);
  }
}
