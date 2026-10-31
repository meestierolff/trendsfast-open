/**
 * The loopback half of `trendsfast login`: a listener on 127.0.0.1 that waits for the
 * browser's redirect to `/callback`, and the authorize address that names it.
 *
 * The address carries exactly four parameters, which is all the server accepts:
 * `callback`, `state`, `public_key` and, when the machine has a usable name, `device`.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import {
  generateLoginKeyPair,
  generateLoginState,
  openCliCredential,
  SealError,
  type CliCredential,
  type LoginKeyPair,
} from "./seal.js";

export const LOGIN_AUTHORIZE_PATH = "/auth/cli/authorize";
export const LOGIN_CALLBACK_PATH = "/callback";
/** The server keeps a sign-in open for ten minutes. */
export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export type LoginOutcome =
  | { kind: "signed_in"; credential: CliCredential }
  | { kind: "cancelled" }
  | { kind: "expired" }
  | { kind: "failed"; reason: string };

/** What a machine is called on the consent screen and in the key's name: letters, digits,
 * spaces and `._'()-` only, at most 64 characters; undefined when nothing usable is left. */
export function deviceName(raw: string = hostname()): string | undefined {
  const cleaned = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._'()-]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
  let result = "";
  for (const character of cleaned) {
    if (result.length + character.length > 64) break;
    result += character;
  }
  result = result.trim();
  return result ? result : undefined;
}

export function authorizeUrl(
  baseUrl: string,
  parameters: { callback: string; state: string; publicKey: string; device?: string | undefined },
): string {
  const url = new URL(LOGIN_AUTHORIZE_PATH, baseUrl);
  url.searchParams.set("callback", parameters.callback);
  url.searchParams.set("state", parameters.state);
  url.searchParams.set("public_key", parameters.publicKey);
  if (parameters.device) url.searchParams.set("device", parameters.device);
  return url.href;
}

function sameState(received: string, expected: string): boolean {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page the browser lands on. It says what happened and carries nothing secret. */
function page(response: ServerResponse, status: number, title: string, body: string): Promise<void> {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#111}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style></head><body><h1>${escape(title)}</h1><p>${escape(body)}</p></body></html>`;
  return new Promise((resolve) => {
    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      connection: "close",
    });
    response.end(html, () => resolve());
  });
}

export interface LoopbackSession {
  url: string;
  port: number;
  /** Waits for the browser, at most `timeoutMs`; then closes the listener. */
  wait(timeoutMs?: number): Promise<LoginOutcome>;
  close(): void;
}

/** Binds 127.0.0.1 on a random port and builds the authorize address for it. */
export async function startLoopbackSession(options: {
  baseUrl: string;
  device?: string | undefined;
  keyPair?: LoginKeyPair;
  state?: string;
}): Promise<LoopbackSession> {
  const keys = options.keyPair ?? generateLoginKeyPair();
  const state = options.state ?? generateLoginState();
  let settle: (outcome: LoginOutcome) => void = () => {};
  const settled = new Promise<LoginOutcome>((resolve) => {
    settle = resolve;
  });
  let done = false;
  let port = 0;

  const finish = (outcome: LoginOutcome) => {
    if (done) return;
    done = true;
    settle(outcome);
  };

  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(404, { connection: "close" }).end();
      return;
    }
    if (request.method !== "GET" || url.pathname !== LOGIN_CALLBACK_PATH) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", connection: "close" }).end("Not found");
      return;
    }
    if (request.headers.host !== `127.0.0.1:${port}`) {
      await page(response, 400, "Not for this sign-in", "This address only answers the browser that signs in to trendsfast.");
      return;
    }
    const states = url.searchParams.getAll("state");
    if (done) {
      await page(response, 400, "Sign-in already finished", "This trendsfast login has already finished. You can close this tab.");
      return;
    }
    if (states.length !== 1 || !sameState(states[0]!, state)) {
      // Someone else's redirect, or a stale tab: refuse it and keep waiting for the real one.
      await page(response, 400, "Not this sign-in", "This sign-in does not belong to the trendsfast login waiting here. Use the most recent address it printed.");
      return;
    }
    const errors = url.searchParams.getAll("error");
    const sealed = url.searchParams.getAll("sealed");
    if (errors.length === 1 && errors[0] === "access_denied" && sealed.length === 0) {
      await page(response, 200, "Sign-in cancelled", "Nothing was created. You can close this tab.");
      finish({ kind: "cancelled" });
      return;
    }
    if (sealed.length !== 1 || errors.length) {
      await page(response, 400, "Sign-in failed", "The sign-in did not complete. Run trendsfast login again.");
      finish({ kind: "failed", reason: "callback" });
      return;
    }
    try {
      const credential = openCliCredential(keys.privateKey, keys.publicKey, state, sealed[0]!);
      await page(response, 200, "Signed in", "Signed in. You can close this tab.");
      finish({ kind: "signed_in", credential });
    } catch (error) {
      await page(response, 400, "Sign-in failed", "The key could not be read. Run trendsfast login again.");
      finish({ kind: "failed", reason: error instanceof SealError ? `seal_${error.reason}` : "seal" });
    }
  };

  const server: Server = createServer((request, response) => {
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { connection: "close" }).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  const callback = `http://127.0.0.1:${port}${LOGIN_CALLBACK_PATH}`;

  const close = () => {
    server.close();
    server.closeAllConnections?.();
  };

  return {
    url: authorizeUrl(options.baseUrl, { callback, state, publicKey: keys.publicKey, device: options.device }),
    port,
    async wait(timeoutMs = LOGIN_TIMEOUT_MS) {
      const timer = setTimeout(() => finish({ kind: "expired" }), timeoutMs);
      const outcome = await settled;
      clearTimeout(timer);
      close();
      return outcome;
    },
    close() {
      finish({ kind: "failed", reason: "closed" });
      close();
    },
  };
}
