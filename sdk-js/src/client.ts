import { randomUUID } from "node:crypto";
import {
  API_KEY_ENV,
  BASE_URL_ENV,
  DEFAULT_BASE_URL,
  MAX_CREDITS_CEILING,
  OPERATIONS,
  PAID_TIMEOUT_MS,
  PATHS,
  READ_CREDITS,
  READ_TIMEOUT_MS,
  UUID_PATTERN,
  productById,
  type Operation,
  type ProductId,
} from "./catalog.js";
import { credentialsPath, readStoredCredentials, type Env } from "./credentials.js";
import {
  AuthRequiredError,
  ConflictError,
  InvalidRequestError,
  OutcomeUnconfirmedError,
  ProductRequiresContextError,
  ServiceUnavailableError,
  TrendsFastError,
  errorFromResponse,
} from "./errors.js";
import type {
  AskOptions,
  CallOptions,
  ContextResponse,
  DiscoverOptions,
  GlobalOptions,
  HistoryResponse,
  NicheOptions,
  ProductOptions,
  QuoteResponse,
  TemporaryNiche,
  TrendFilters,
  TrendsResult,
  WalletResponse,
} from "./types.js";
import { SDK_VERSION } from "./version.js";

export type KeySource = "option" | "env" | "stored" | "none";

export interface TrendsFastOptions {
  /** Defaults to `TRENDSFAST_API_KEY`, then the key `trendsfast login` stored. */
  apiKey?: string;
  /** Defaults to `TRENDSFAST_BASE_URL`, then the stored key's origin, then https://trendsfast.com.
   * Only https, except http://127.0.0.1 and http://localhost for local testing. */
  baseUrl?: string;
  /** Retries of network errors, 5xx and 429, always with the same request ID. Default 3. */
  maxRetries?: number;
  /** A Retry-After longer than this is not waited for; the error is raised instead. Default 30 s. */
  maxRetryDelayMs?: number;
  /** Timeout of a free read. Default 30 s. */
  timeoutMs?: number;
  /** Timeout of a paid call. Default 150 s, past the server's own 120 s. */
  paidTimeoutMs?: number;
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
  /** Where environment variables are read from. Default `process.env`. */
  env?: Env;
  /** Where the CLI's stored credentials are read from. Default the CLI's own path. */
  credentialsPath?: string;
  /** Set false to ignore the CLI's stored credentials. */
  useStoredCredentials?: boolean;
  /** For tests: how the client waits between retries. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** The fields of `TrendFilters`, the only keys sent as `filters`. */
const FILTER_KEYS = [
  "platforms",
  "content_types",
  "categories",
  "signals",
  "evidence_quality",
  "country",
  "region",
  "observed_market",
  "language",
  "observed_from",
  "observed_to",
  "lookback_hours",
  "history_days",
  "compare_to",
  "limit",
] as const satisfies readonly (keyof TrendFilters)[];

const UNCERTAIN_CODES = new Set(["NO_RESPONSE", "INVALID_RESPONSE", "RESPONSE_IDENTITY_MISMATCH"]);

/** An https origin, or http on the loopback host for local testing. Throws otherwise. */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidRequestError("INVALID_BASE_URL", `Not a URL: ${value}`, "usage");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new InvalidRequestError(
      "INVALID_BASE_URL",
      "The TrendsFast base URL must use https (http only for 127.0.0.1 or localhost).",
      "usage",
    );
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new InvalidRequestError(
      "INVALID_BASE_URL",
      "The TrendsFast base URL is an origin only, such as https://trendsfast.com.",
      "usage",
    );
  return url.origin;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResult(value: unknown): value is TrendsResult {
  return (
    isRecord(value) &&
    value.version === "trends-api-v3" &&
    typeof value.result_id === "string" &&
    typeof value.request_id === "string" &&
    typeof value.operation === "string" &&
    isRecord(value.data) &&
    isRecord(value.usage)
  );
}

function requireUuid(value: string, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    throw new InvalidRequestError("INVALID_INPUT", `${label} must be a UUID.`, "usage");
  return value;
}

function requireText(value: unknown, label: string, min: number, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max)
    throw new InvalidRequestError(
      "INVALID_INPUT",
      `${label} must be ${min} to ${max} characters.`,
      "usage",
    );
  return text;
}

/** The filters set in `options`, or undefined when none is. */
export function pickFilters(options: TrendFilters): TrendFilters | undefined {
  const filters: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) if (options[key] !== undefined) filters[key] = options[key];
  return Object.keys(filters).length ? (filters as TrendFilters) : undefined;
}

function nicheFlags(options: { include_adjacent?: boolean; include_global?: boolean }) {
  return {
    ...(options.include_adjacent !== undefined ? { include_adjacent: options.include_adjacent } : {}),
    ...(options.include_global !== undefined ? { include_global: options.include_global } : {}),
  };
}

/**
 * The TrendsFast V3 API.
 *
 * Every paid call carries a request ID and `max_credits`. A lost answer is retried with the
 * same request ID, so it is never charged twice, and then read back once for free; if the
 * outcome is still unknown the call ends in `OutcomeUnconfirmedError`, and
 * `recover(requestId)` reads it later. It never sends a paid call again under a new ID.
 */
export class TrendsFast {
  readonly baseUrl: string;
  readonly keySource: KeySource;
  readonly #apiKey: string | undefined;
  readonly #fetch: typeof globalThis.fetch;
  readonly #userAgent: string;
  readonly #maxRetries: number;
  readonly #maxRetryDelayMs: number;
  readonly #timeoutMs: number;
  readonly #paidTimeoutMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: TrendsFastOptions = {}) {
    const env = options.env ?? process.env;
    const stored =
      options.apiKey || env[API_KEY_ENV]?.trim() || options.useStoredCredentials === false
        ? null
        : readStoredCredentials(options.credentialsPath ?? credentialsPath(env));
    if (options.apiKey) {
      this.#apiKey = options.apiKey;
      this.keySource = "option";
    } else if (env[API_KEY_ENV]?.trim()) {
      this.#apiKey = env[API_KEY_ENV]!.trim();
      this.keySource = "env";
    } else if (stored) {
      this.#apiKey = stored.api_key;
      this.keySource = "stored";
    } else {
      this.#apiKey = undefined;
      this.keySource = "none";
    }
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? (env[BASE_URL_ENV]?.trim() || stored?.base_url || DEFAULT_BASE_URL),
    );
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#userAgent = options.userAgent ?? `trendsfast-js/${SDK_VERSION}`;
    this.#maxRetries = Math.max(0, Math.min(options.maxRetries ?? 3, 10));
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
    this.#timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS;
    this.#paidTimeoutMs = options.paidTimeoutMs ?? PAID_TIMEOUT_MS;
    this.#sleep =
      options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  /** Whether a key is configured. Nothing is sent to check it. */
  get hasApiKey(): boolean {
    return Boolean(this.#apiKey);
  }

  // ---- Free reads ------------------------------------------------------------------------

  /** The brand's confirmed context and its `context_id`, or `context: null`. Free. */
  async context(): Promise<ContextResponse> {
    return (await this.#read(PATHS.context)) as ContextResponse;
  }

  /** The credit balance shared by the dashboard, REST and MCP. Free. */
  async wallet(): Promise<WalletResponse> {
    return (await this.#read(PATHS.wallet)) as WalletResponse;
  }

  /** What a call costs before you make it. Free. A product is quoted with `operation` niche. */
  async quote(operation: Operation, product?: ProductId): Promise<QuoteResponse> {
    if (!OPERATIONS.includes(operation))
      throw new InvalidRequestError("INVALID_INPUT", `Unknown operation: ${String(operation)}`, "usage");
    if (product !== undefined) {
      productById(product);
      if (operation !== "niche")
        throw new InvalidRequestError("INVALID_INPUT", "A product is quoted with operation niche.", "usage");
    }
    const quote = (await this.#read(PATHS.quote, {
      operation,
      ...(product ? { product } : {}),
    })) as QuoteResponse;
    if (!isRecord(quote) || quote.operation !== operation)
      throw new ServiceUnavailableError("RESPONSE_IDENTITY_MISMATCH", "The quote answered another operation.", "network");
    return quote;
  }

  /** Your saved results, newest first, 50 per page. Free. */
  async history(cursor?: string): Promise<HistoryResponse> {
    return (await this.#read(PATHS.history, cursor ? { cursor } : undefined)) as HistoryResponse;
  }

  /** Reread a saved result, or its next page with `next_cursor`. Free. */
  async result(id: string, cursor?: string): Promise<TrendsResult> {
    requireUuid(id, "The result ID");
    const result = await this.#read(PATHS.result.replace("{id}", id), cursor ? { cursor } : undefined, {
      resultId: id,
    });
    if (!isResult(result) || result.result_id !== id)
      throw new ServiceUnavailableError("RESPONSE_IDENTITY_MISMATCH", "TrendsFast answered with another result.", "network");
    return result;
  }

  /** The outcome of a paid call, by the request ID it carried. Free; starts nothing. */
  async recover(requestId: string): Promise<TrendsResult> {
    requireUuid(requestId, "The request ID");
    let result: unknown;
    try {
      result = await this.#read(PATHS.request.replace("{id}", requestId), undefined, { requestId });
    } catch (error) {
      if (error instanceof TrendsFastError && error.status === 404 && error.code !== "V3_DISABLED")
        throw new InvalidRequestError(
          "NOT_FOUND",
          `TrendsFast has no record of request ${requestId}. If it was sent in the last minute, read it again; otherwise it never started, and the same call can be sent again with this request ID.`,
          "usage",
          { status: 404, requestId, body: error.body },
        );
      throw error;
    }
    if (!isResult(result) || result.request_id !== requestId)
      throw new ServiceUnavailableError("RESPONSE_IDENTITY_MISMATCH", "TrendsFast answered with another request.", "network");
    return result;
  }

  // ---- Products (paid; they collect the brand's own sources fresh) ------------------------

  /** Customers (10 credits): conversations where people like the brand's customers describe a
   * problem, ask a question or request something. */
  customers(options: ProductOptions = {}): Promise<TrendsResult> {
    return this.product("customers", options);
  }

  /** Trending (25 credits): posts, videos and searches gaining attention in the niche, then
   * in the niches next to it. */
  trending(options: ProductOptions = {}): Promise<TrendsResult> {
    return this.product("niche", options);
  }

  /** Competitors (30 credits): the competitors' recent posts and how each performed. */
  competitors(options: ProductOptions = {}): Promise<TrendsResult> {
    return this.product("competitors", options);
  }

  /** Formats (20 credits): short videos that win attention, with their opening lines. */
  formats(options: ProductOptions = {}): Promise<TrendsResult> {
    return this.product("formats", options);
  }

  /** Search (35 credits): search interest, and what AI assistants answer to the category's
   * buyer question. */
  search(options: ProductOptions = {}): Promise<TrendsResult> {
    return this.product("search", options);
  }

  /** Any product by its API id, on the brand's confirmed context. */
  async product(id: ProductId, options: ProductOptions = {}): Promise<TrendsResult> {
    const product = productById(id);
    const contextId = await this.#brandContextId(options.context_id);
    const filters = pickFilters(options);
    return this.query(
      "niche",
      { product: product.id, context_id: contextId, ...(filters ? { filters } : {}), ...nicheFlags(options) },
      { ...options, max_credits: options.max_credits ?? product.credits },
    );
  }

  // ---- Index reads (paid, cheaper; read saved observations only) --------------------------

  /** What is trending across the whole index (1 credit). No brand needed. */
  globalTrends(options: GlobalOptions = {}): Promise<TrendsResult> {
    return this.query("global", { ...pickFilters(options) }, options);
  }

  /** The index ranked against a niche you describe (3 credits). Without a description it
   * ranks against the brand's confirmed context instead. Collects nothing. */
  async niche(description?: string | TemporaryNiche, options: NicheOptions = {}): Promise<TrendsResult> {
    const filters = pickFilters(options);
    let target: Record<string, unknown>;
    if (description === undefined || description === null) {
      target = { context_id: await this.#brandContextId(options.context_id) };
    } else {
      const niche = typeof description === "string" ? { description } : { ...description };
      niche.description = requireText(niche.description, "The niche description", 3, 2000);
      target = { niche };
    }
    return this.query("niche", { ...target, ...(filters ? { filters } : {}), ...nicheFlags(options) }, options);
  }

  /** One bounded question answered from saved evidence (5 credits). */
  async ask(question: string, options: AskOptions = {}): Promise<TrendsResult> {
    const text = requireText(question, "The question", 3, 1000);
    return this.query("ask", { question: text, ...(await this.#scope(options)) }, options);
  }

  /** One question across global, core and adjacent scope and every channel (5 credits). */
  async discover(question?: string, options: DiscoverOptions = {}): Promise<TrendsResult> {
    const text = question === undefined ? undefined : requireText(question, "The question", 3, 1000);
    return this.query(
      "discover",
      {
        ...(text ? { question: text } : {}),
        ...(options.scope ? { scope: options.scope } : {}),
        ...(options.channels ? { channels: options.channels } : {}),
        ...(await this.#scope(options)),
      },
      options,
    );
  }

  /**
   * One paid call with its input exactly as given. `max_credits` defaults to the plain
   * price of the operation (a product's price when `input.product` is set); `request_id`
   * defaults to a new UUID.
   */
  async query(operation: Operation, input: Record<string, unknown>, options: CallOptions = {}): Promise<TrendsResult> {
    if (!OPERATIONS.includes(operation))
      throw new InvalidRequestError("INVALID_INPUT", `Unknown operation: ${String(operation)}`, "usage");
    const requestId = requireUuid(options.request_id ?? randomUUID(), "The request ID");
    const product = typeof input.product === "string" ? productById(input.product as ProductId) : undefined;
    const maxCredits = options.max_credits ?? product?.credits ?? READ_CREDITS[operation];
    if (!Number.isInteger(maxCredits) || maxCredits < 0 || maxCredits > MAX_CREDITS_CEILING)
      throw new InvalidRequestError(
        "INVALID_INPUT",
        `max_credits must be a whole number from 0 to ${MAX_CREDITS_CEILING}.`,
        "usage",
        { requestId },
      );
    const body = { request_id: requestId, max_credits: maxCredits, input };
    const valid = (value: unknown) =>
      isResult(value) && value.request_id === requestId && value.operation === operation;
    try {
      return (await this.#send("POST", PATHS[operation], {
        body,
        timeoutMs: this.#paidTimeoutMs,
        requestId,
        valid,
      })) as TrendsResult;
    } catch (error) {
      if (!(error instanceof TrendsFastError)) throw error;
      const uncertain = error.status === 0 || error.status >= 500 || UNCERTAIN_CODES.has(error.code);
      if (!uncertain || error.status === 429) throw error;
      return this.#recoverOnce(requestId, operation, error);
    }
  }

  // ---- Internals -------------------------------------------------------------------------

  /** After a lost answer: one free read of the request, then the outcome as it stands. */
  async #recoverOnce(requestId: string, operation: Operation, cause: TrendsFastError): Promise<TrendsResult> {
    const next = `Read it with recover("${requestId}") or \`trendsfast request ${requestId}\` before sending anything new; never send it again under a new request ID.`;
    try {
      const result = await this.#send("GET", PATHS.request.replace("{id}", requestId), {
        timeoutMs: this.#timeoutMs,
        requestId,
        retries: 0,
        valid: (value) => isResult(value) && value.request_id === requestId && value.operation === operation,
      });
      return result as TrendsResult;
    } catch (error) {
      if (error instanceof TrendsFastError) {
        if (error.code === "REQUEST_RELEASED")
          throw new ConflictError(
            "REQUEST_RELEASED",
            `The call with request ID ${requestId} ended without a result or a charge. Send it again with a new request ID.`,
            "conflict",
            { status: error.status, requestId },
          );
        if (error.kind === "conflict" && error.status === 410) throw error;
        const code =
          error.code === "REQUEST_IN_PROGRESS" || error.code === "EFFECT_UNKNOWN" ? error.code : "REQUEST_OUTCOME_UNCONFIRMED";
        const why =
          error.status === 404
            ? `TrendsFast has no record of request ${requestId} yet. If a later read still finds none, it never started, and the same call can be sent again with this request ID.`
            : error.code === "REQUEST_IN_PROGRESS"
              ? `The call with request ID ${requestId} is still running.`
              : `TrendsFast could not confirm the outcome of request ${requestId}; it may have run.`;
        throw new OutcomeUnconfirmedError(code, `${why} ${next}`, "unconfirmed", {
          status: error.status || cause.status,
          requestId,
          recovery: next,
        });
      }
      throw error;
    }
  }

  async #brandContextId(given?: string): Promise<string> {
    if (given) return requireUuid(given, "The context ID");
    const { context } = await this.context();
    if (!context || context.kind !== "CONFIRMED_CONTEXT" || !context.context_id)
      throw new ProductRequiresContextError(
        "PRODUCT_REQUIRES_CONTEXT",
        "This project has no confirmed brand context yet. Confirm your brand at https://trendsfast.com/dashboard, or read a niche you describe without a product.",
        "usage",
      );
    return context.context_id;
  }

  async #scope(options: AskOptions): Promise<Record<string, unknown>> {
    const filters = pickFilters(options);
    const target = options.context_id
      ? { context_id: requireUuid(options.context_id, "The context ID") }
      : options.niche
        ? { niche: { ...options.niche, description: requireText(options.niche.description, "The niche description", 3, 2000) } }
        : options.brand
          ? { context_id: await this.#brandContextId() }
          : {};
    return { ...target, ...(filters ? { filters } : {}), ...nicheFlags(options) };
  }

  async #read(path: string, query?: Record<string, string>, ids: { requestId?: string; resultId?: string } = {}) {
    try {
      return await this.#send("GET", path, { query, timeoutMs: this.#timeoutMs, ...ids });
    } catch (error) {
      // A free read changes nothing, so an answer that did not arrive is a service failure,
      // not an unknown outcome; only a request still running stays unconfirmed.
      if (
        error instanceof TrendsFastError &&
        error.kind === "unconfirmed" &&
        error.code !== "REQUEST_IN_PROGRESS" &&
        error.code !== "EFFECT_UNKNOWN"
      )
        throw new ServiceUnavailableError(
          error.code,
          error.status
            ? `TrendsFast is not available right now (HTTP ${error.status}). This read is free; run it again later.`
            : "No answer arrived from TrendsFast. This read is free; run it again later.",
          "network",
          {
            status: error.status,
            ...(ids.requestId ? { requestId: ids.requestId } : {}),
            ...(ids.resultId ? { resultId: ids.resultId } : {}),
          },
        );
      throw error;
    }
  }

  async #send(
    method: "GET" | "POST",
    path: string,
    options: {
      query?: Record<string, string> | undefined;
      body?: unknown;
      timeoutMs: number;
      requestId?: string;
      resultId?: string;
      retries?: number;
      valid?: (value: unknown) => boolean;
    },
  ): Promise<unknown> {
    if (!this.#apiKey)
      throw new AuthRequiredError(
        "AUTH_REQUIRED",
        "No TrendsFast API key: run `trendsfast login`, or set TRENDSFAST_API_KEY to a key from https://trendsfast.com/dashboard/api-keys.",
        "auth",
      );
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const retries = options.retries ?? this.#maxRetries;
    const ids = {
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.resultId ? { resultId: options.resultId } : {}),
    };
    let last: TrendsFastError | undefined;
    for (let attempt = 0; ; attempt++) {
      let waitMs: number | undefined;
      try {
        const response = await this.#fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            accept: "application/json",
            "user-agent": this.#userAgent,
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        const text = await response.text();
        let parsed: unknown;
        let parsedOk = false;
        try {
          parsed = JSON.parse(text);
          parsedOk = true;
        } catch {
          parsed = undefined;
        }
        if (response.status >= 300 && response.status < 400)
          throw new ServiceUnavailableError(
            "REDIRECT_NOT_FOLLOWED",
            `TrendsFast answered with a redirect (HTTP ${response.status}), which this client does not follow. Check the base URL.`,
            "network",
            { status: response.status, ...ids },
          );
        if (response.ok) {
          if (parsedOk && (!options.valid || options.valid(parsed))) return parsed;
          last = new OutcomeUnconfirmedError(
            parsedOk ? "RESPONSE_IDENTITY_MISMATCH" : "INVALID_RESPONSE",
            "TrendsFast's answer could not be read.",
            "unconfirmed",
            { status: response.status, ...ids },
          );
        } else {
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
          const failure = errorFromResponse(response.status, parsed, {
            ...(options.requestId ? { requestId: options.requestId } : {}),
            ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
          });
          if (response.status !== 429 && response.status < 500) throw failure;
          last = failure;
          if (retryAfter !== undefined) waitMs = retryAfter * 1000;
        }
      } catch (error) {
        if (error instanceof TrendsFastError) throw error;
        const detail = error instanceof Error && error.name === "TimeoutError" ? " (timed out)" : "";
        last = new OutcomeUnconfirmedError(
          "NO_RESPONSE",
          `No answer arrived from TrendsFast${detail}. The call may have run.`,
          "unconfirmed",
          ids,
        );
      }
      if (attempt >= retries) break;
      const delay = waitMs ?? Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
      if (delay > this.#maxRetryDelayMs) break;
      await this.#sleep(delay);
    }
    throw last;
  }
}
