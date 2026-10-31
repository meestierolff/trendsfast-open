/** What every command shares: the streams, the environment and a configured SDK client. */
import { userAgent } from "./agent-origin.js";
import type { Io } from "./io.js";
import { TrendsFast } from "./sdk/client.js";
import { DEFAULT_BASE_URL } from "./sdk/catalog.js";
import type { Env } from "./sdk/credentials.js";

export interface Context {
  io: Io;
  env: Env;
  userAgent: string;
  fetch: typeof globalThis.fetch;
  /** --base-url, when the command was given one. */
  baseUrlFlag: string | undefined;
  out(text: string): void;
  err(text: string): void;
  client(options?: { maxRetries?: number }): TrendsFast;
  /** The origin to sign in to: --base-url, TRENDSFAST_BASE_URL, then trendsfast.com. */
  loginBaseUrl(): string;
}

export function createContext(io: Io, baseUrlFlag: string | undefined): Context {
  const env = io.env;
  const fetchImpl = io.fetch ?? globalThis.fetch.bind(globalThis);
  const agent = userAgent(env);
  return {
    io,
    env,
    userAgent: agent,
    fetch: fetchImpl,
    baseUrlFlag,
    out: (text) => void io.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
    err: (text) => void io.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
    client: (options = {}) =>
      new TrendsFast({
        env,
        fetch: fetchImpl,
        userAgent: agent,
        ...(baseUrlFlag ? { baseUrl: baseUrlFlag } : {}),
        ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      }),
    loginBaseUrl: () => baseUrlFlag ?? (env.TRENDSFAST_BASE_URL?.trim() || DEFAULT_BASE_URL),
  };
}
