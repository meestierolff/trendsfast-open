/**
 * Typed errors for every way a TrendsFast call can end without a result.
 *
 * Each error keeps the request ID it belongs to, so a caller can always recover the outcome
 * of a paid call with `recover(requestId)` instead of sending it again under a new ID. The
 * `exitCode` is what the `trendsfast` CLI exits with, so scripts and agents can branch on it
 * without parsing text.
 */

export type ErrorKind =
  | "usage"
  | "auth"
  | "credits"
  | "conflict"
  | "rate_limited"
  | "unconfirmed"
  | "network";

/** The CLI's exit codes, by kind. 0 is success. */
export const EXIT_CODES: Readonly<Record<ErrorKind, number>> = {
  usage: 1,
  auth: 2,
  credits: 3,
  conflict: 4,
  rate_limited: 5,
  unconfirmed: 6,
  network: 7,
};

export interface TrendsFastErrorDetails {
  status?: number;
  requestId?: string;
  resultId?: string;
  recovery?: string;
  retryAfterSeconds?: number;
  /** TrendsFast's own error body, when it sent one. Never contains a key. */
  body?: unknown;
}

export class TrendsFastError extends Error {
  /** TrendsFast's error code, such as `INSUFFICIENT_CREDITS`, or a local code. */
  readonly code: string;
  /** The HTTP status, or 0 when no answer arrived or the error was raised locally. */
  readonly status: number;
  readonly kind: ErrorKind;
  readonly requestId?: string;
  readonly resultId?: string;
  /** What to do next, in a sentence. */
  readonly recovery?: string;
  readonly retryAfterSeconds?: number;
  readonly body?: unknown;

  constructor(code: string, message: string, kind: ErrorKind, details: TrendsFastErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.kind = kind;
    this.status = details.status ?? 0;
    if (details.requestId !== undefined) this.requestId = details.requestId;
    if (details.resultId !== undefined) this.resultId = details.resultId;
    if (details.recovery !== undefined) this.recovery = details.recovery;
    if (details.retryAfterSeconds !== undefined) this.retryAfterSeconds = details.retryAfterSeconds;
    if (details.body !== undefined) this.body = details.body;
  }

  /** Whether sending the same call again with the same request ID can succeed. */
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "network" || this.kind === "unconfirmed";
  }

  get exitCode(): number {
    return EXIT_CODES[this.kind];
  }
}

/** 401: the key is missing, invalid, expired or revoked (`AUTH_REQUIRED`, `AUTH_INVALID`,
 * `AUTH_EXPIRED`, `AUTH_REVOKED`). */
export class AuthRequiredError extends TrendsFastError {}
/** 403: the key lacks the scope this call needs (`INSUFFICIENT_SCOPE`, or `FORBIDDEN` over
 * REST), or the request came from an origin TrendsFast refuses. */
export class InsufficientScopeError extends TrendsFastError {}
/** 402: the balance cannot cover the call. Nothing was charged. */
export class InsufficientCreditsError extends TrendsFastError {}
/** 402: `max_credits` is below the call's price. Nothing was charged. */
export class CreditQuoteExceedsLimitError extends TrendsFastError {}
/** 409: this request ID was already used with different input. */
export class IdempotencyConflictError extends TrendsFastError {}
/** 409: the `context_id` is not the brand's current confirmed context. */
export class ContextNotCurrentError extends TrendsFastError {}
/** 400: a product needs the brand's confirmed context; a typed niche is read without one. */
export class ProductRequiresContextError extends TrendsFastError {}
/** 410: the result expired, its brand context changed, or its evidence was removed. */
export class ResultUnavailableError extends TrendsFastError {}
/** 429: too many calls. Nothing was started; wait and send the same call again. */
export class RateLimitedError extends TrendsFastError {}
/** The call may have run. Read it with `recover(requestId)`; never resend it under a new ID. */
export class OutcomeUnconfirmedError extends TrendsFastError {}
/** Any other refusal of the input (400, 404, 405, 413, 415). Nothing was started. */
export class InvalidRequestError extends TrendsFastError {}
/** Any other conflict (409) or gone (410), such as a paused account. */
export class ConflictError extends TrendsFastError {}
/** No answer, or a server failure, on a call that cannot have charged anything. */
export class ServiceUnavailableError extends TrendsFastError {}

type ErrorClass = new (
  code: string,
  message: string,
  kind: ErrorKind,
  details?: TrendsFastErrorDetails,
) => TrendsFastError;

/** The error codes TrendsFast documents, with the class and kind each one maps to. */
export const ERROR_CODE_CLASSES: Readonly<Record<string, readonly [ErrorClass, ErrorKind]>> = {
  AUTH_REQUIRED: [AuthRequiredError, "auth"],
  AUTH_INVALID: [AuthRequiredError, "auth"],
  AUTH_EXPIRED: [AuthRequiredError, "auth"],
  AUTH_REVOKED: [AuthRequiredError, "auth"],
  INSUFFICIENT_SCOPE: [InsufficientScopeError, "auth"],
  FORBIDDEN: [InsufficientScopeError, "auth"],
  ORIGIN_REJECTED: [InsufficientScopeError, "auth"],
  INSUFFICIENT_CREDITS: [InsufficientCreditsError, "credits"],
  CREDIT_QUOTE_EXCEEDS_LIMIT: [CreditQuoteExceedsLimitError, "credits"],
  IDEMPOTENCY_CONFLICT: [IdempotencyConflictError, "conflict"],
  CONTEXT_NOT_CURRENT: [ContextNotCurrentError, "conflict"],
  PRODUCT_REQUIRES_CONTEXT: [ProductRequiresContextError, "usage"],
  RESULT_UNAVAILABLE: [ResultUnavailableError, "conflict"],
  RESULT_CONTEXT_CHANGED: [ResultUnavailableError, "conflict"],
  RESULT_EVIDENCE_UNAVAILABLE: [ResultUnavailableError, "conflict"],
  RATE_LIMITED: [RateLimitedError, "rate_limited"],
  CONCURRENT_LIMIT: [RateLimitedError, "rate_limited"],
  REQUEST_OUTCOME_UNCONFIRMED: [OutcomeUnconfirmedError, "unconfirmed"],
  REQUEST_IN_PROGRESS: [OutcomeUnconfirmedError, "unconfirmed"],
  EFFECT_UNKNOWN: [OutcomeUnconfirmedError, "unconfirmed"],
};

/** The ten codes an agent is told to branch on, each with its own class. */
export const TYPED_ERROR_CODES = [
  "AUTH_REQUIRED",
  "INSUFFICIENT_CREDITS",
  "CREDIT_QUOTE_EXCEEDS_LIMIT",
  "INSUFFICIENT_SCOPE",
  "IDEMPOTENCY_CONFLICT",
  "CONTEXT_NOT_CURRENT",
  "PRODUCT_REQUIRES_CONTEXT",
  "RESULT_UNAVAILABLE",
  "RATE_LIMITED",
  "REQUEST_OUTCOME_UNCONFIRMED",
] as const;

/** What each HTTP status means when TrendsFast sends no code this package knows. */
export const STATUS_KINDS: Readonly<Record<number, readonly [ErrorClass, ErrorKind]>> = {
  400: [InvalidRequestError, "usage"],
  401: [AuthRequiredError, "auth"],
  402: [InsufficientCreditsError, "credits"],
  403: [InsufficientScopeError, "auth"],
  404: [InvalidRequestError, "usage"],
  405: [InvalidRequestError, "usage"],
  409: [ConflictError, "conflict"],
  410: [ResultUnavailableError, "conflict"],
  413: [InvalidRequestError, "usage"],
  415: [InvalidRequestError, "usage"],
  429: [RateLimitedError, "rate_limited"],
  503: [OutcomeUnconfirmedError, "unconfirmed"],
};

const MESSAGES: Readonly<Record<string, string>> = {
  AUTH_REQUIRED:
    "TrendsFast did not accept the API key: it is missing, invalid, expired or revoked. Run `trendsfast login`, or set TRENDSFAST_API_KEY to a key from https://trendsfast.com/dashboard/api-keys.",
  INSUFFICIENT_SCOPE:
    "The API key may not make this call: it lacks the scope it needs. Create a key with the trends:query, trends:read and credits:read scopes.",
  INSUFFICIENT_CREDITS:
    "The credit balance cannot cover this call. Nothing was charged. Plans and packs: https://trendsfast.com/pricing.",
  CREDIT_QUOTE_EXCEEDS_LIMIT:
    "max_credits is below this call's price. Nothing was charged. Read the price for free with quote(), then send it again with max_credits at or above it.",
  IDEMPOTENCY_CONFLICT:
    "This request ID was already used with different input. New input needs a new request ID; read the earlier one for free with recover().",
  CONTEXT_NOT_CURRENT:
    "The context_id is not your brand's current confirmed context. Read the current one for free with context().",
  PRODUCT_REQUIRES_CONTEXT:
    "A product runs on your brand's confirmed context. Confirm your brand at https://trendsfast.com/dashboard, or read a niche you describe without a product.",
  RESULT_UNAVAILABLE:
    "The result is no longer available: it expired, its brand context changed or its evidence was removed. Do not rebuild it from memory.",
  RATE_LIMITED: "TrendsFast is limiting how fast this account can send calls. Nothing was started.",
  REQUEST_OUTCOME_UNCONFIRMED:
    "TrendsFast could not confirm the outcome. The call may have run: read it by its request ID before sending anything new.",
  REQUEST_IN_PROGRESS:
    "An earlier call with this request ID is still running. Read it again by its request ID in a minute.",
  EFFECT_UNKNOWN:
    "TrendsFast does not know whether this call completed. Read it again by its request ID later; never resend it under a new ID.",
  REQUEST_RELEASED:
    "The call with this request ID ended without a result or a charge. Send it again with a new request ID.",
  V3_DISABLED: "The TrendsFast V3 API is not available on this deployment. Nothing was started.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The error TrendsFast's answer stands for. `body` is the parsed JSON body, if any. */
export function errorFromResponse(
  status: number,
  body: unknown,
  options: { requestId?: string; retryAfterSeconds?: number } = {},
): TrendsFastError {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : undefined;
  const recovery = isRecord(body) && typeof body.recovery === "string" ? body.recovery : undefined;
  let mapped = code ? ERROR_CODE_CLASSES[code] : undefined;
  if (!mapped && code === "V3_DISABLED") mapped = [ServiceUnavailableError, "network"];
  if (!mapped && code === "REQUEST_RELEASED") mapped = [ConflictError, "conflict"];
  if (!mapped) mapped = STATUS_KINDS[status];
  if (!mapped) mapped = status >= 500 ? [ServiceUnavailableError, "network"] : [InvalidRequestError, "usage"];
  const [Class, kind] = mapped;
  const label = code ?? `HTTP_${status}`;
  const message =
    (code && MESSAGES[code]) ??
    (status >= 500
      ? `TrendsFast answered HTTP ${status}${code ? ` (${code})` : ""}.`
      : `TrendsFast refused the call with HTTP ${status}${code ? ` (${code})` : ""}.`);
  const details: TrendsFastErrorDetails = { status, body };
  if (options.requestId) details.requestId = options.requestId;
  if (recovery) details.recovery = recovery;
  if (options.retryAfterSeconds !== undefined) details.retryAfterSeconds = options.retryAfterSeconds;
  return new Class(label, message, kind, details);
}
