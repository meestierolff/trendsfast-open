import { REMOTE_MCP_CONTRACT_VERSION, SAFE_REMOTE_ERROR_CODES, SAFE_REMOTE_ERROR_MESSAGES, } from "./constants.js";
export class TrendsFastError extends Error {
    code;
    retryable;
    retryAfterSeconds;
    constructor(code, message, options = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "TrendsFastError";
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    }
}
export function safeRemoteError(version, code, retryable = false, retryAfterSeconds = null) {
    const validDelay = Number.isInteger(retryAfterSeconds) &&
        typeof retryAfterSeconds === "number" &&
        retryAfterSeconds > 0 &&
        retryAfterSeconds <= 86_400;
    const validCode = typeof code === "string" &&
        SAFE_REMOTE_ERROR_CODES.includes(code) &&
        Object.hasOwn(SAFE_REMOTE_ERROR_MESSAGES, code);
    const validTuple = code === "RATE_LIMITED"
        ? retryable === true && validDelay
        : retryable === false && retryAfterSeconds === null;
    const safeCode = version === REMOTE_MCP_CONTRACT_VERSION && validCode && validTuple
        ? code
        : "INTERNAL_FAILURE";
    const safeDelay = safeCode === "RATE_LIMITED" ? retryAfterSeconds : null;
    return new TrendsFastError(safeCode, SAFE_REMOTE_ERROR_MESSAGES[safeCode] ??
        SAFE_REMOTE_ERROR_MESSAGES.INTERNAL_FAILURE ??
        "The request could not be completed safely.", {
        retryable: safeCode === "RATE_LIMITED",
        retryAfterSeconds: safeDelay,
    });
}
export function safeErrorMessage(error) {
    if (error instanceof TrendsFastError)
        return `${error.code}: ${error.message}`;
    return "The command failed safely. No credential or remote payload was logged.";
}
export function redactText(value) {
    return value
        .replace(/Authorization\s*:\s*Bearer\s+[^\s"']+/gi, "Authorization: Bearer <redacted>")
        .replace(/Bearer\s+[A-Za-z0-9._~-]{16,}/gi, "Bearer <redacted>")
        .replace(/\b(?:tf|trendsfast)_[A-Za-z0-9._~-]{12,}\b/gi, "<redacted>");
}
