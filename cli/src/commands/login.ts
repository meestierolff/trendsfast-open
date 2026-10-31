/**
 * `trendsfast login`: get a project key onto this machine without anyone pasting it into an
 * agent's context. Four ways in, chosen for where the browser is:
 *
 * - foreground (a person at a terminal): wait here for the browser's loopback redirect;
 * - background (an agent's shell, same machine): a detached listener waits instead;
 * - code flow (browser on another machine: cloud agents, containers, SSH): the browser shows
 *   a sealed code, and `--code` opens it here;
 * - paste (a key created in the dashboard), read without echo.
 */
import { randomUUID } from "node:crypto";
import type { FlagSpec } from "../args.js";
import type { Context } from "../context.js";
import { API_KEY_PATTERN, API_KEYS_URL } from "../sdk/catalog.js";
import { credentialsPath, deleteFile, keyPrefix, readStoredCredentials, writeStoredCredentials } from "../sdk/credentials.js";
import { normalizeBaseUrl } from "../sdk/client.js";
import { loginTimeoutMs, startBackgroundLogin } from "../login/background.js";
import { hasDisplay, isSsh, openBrowser } from "../login/browser.js";
import { readSecretLine } from "../login/paste.js";
import { loginPreflight } from "../login/preflight.js";
import { exportPrivateKey, generateLoginKeyPair, generateLoginState, importPrivateKey, openCliCredential, SealError } from "../login/seal.js";
import { authorizeUrl, deviceName, startLoopbackSession } from "../login/session.js";
import {
  deletePendingCodeLogin,
  effectiveLoginStatus,
  readPendingCodeLogin,
  statusPath,
  updateLoginStatus,
  writeLoginStatus,
  writePendingCodeLogin,
} from "../login/state.js";
import { signedInLine, storeCredential } from "../login/store.js";

export const LOGIN_FLAGS: FlagSpec[] = [
  { name: "background", type: "boolean", help: "Start a listener that outlives this command, print the address and exit 0 (default without a terminal)" },
  { name: "foreground", type: "boolean", help: "Wait here for the browser, up to 10 minutes (default in a terminal)" },
  { name: "code-flow", type: "boolean", help: "For a browser on another machine: the page shows a code to pass to --code" },
  { name: "code", type: "string", value: "<code>", help: "Finish a --code-flow sign-in with the code the browser showed" },
  { name: "paste", type: "boolean", help: "Read a key from the dashboard from stdin, without echo" },
  { name: "status", type: "boolean", help: "Say whether a sign-in is waiting, finished, cancelled or expired" },
  { name: "no-browser", type: "boolean", help: "Print the address without opening a browser" },
];

const unavailable = (base: string) =>
  `Browser sign-in is not available on ${base} yet. Create a key at ${API_KEYS_URL}, then run \`trendsfast login --paste\` in your own terminal and paste it there; it is read without echo and never shown.`;

type Mode = "foreground" | "background" | "code";

export function chooseLoginMode(flags: Record<string, unknown>, ctx: Pick<Context, "io">): Mode {
  if (flags["code-flow"]) return "code";
  if (flags.background) return "background";
  if (flags.foreground) return "foreground";
  const tty = Boolean(ctx.io.stdout.isTTY);
  const display = hasDisplay(ctx.io);
  if (!display && !tty) return "code";
  if (isSsh(ctx.io.env) && flags["no-browser"]) return "code";
  return tty ? "foreground" : "background";
}

export async function login(ctx: Context, flags: Record<string, unknown>): Promise<number> {
  const now = ctx.io.now();
  if (flags.status) return loginStatus(ctx);
  let base: string;
  try {
    base = normalizeBaseUrl(ctx.loginBaseUrl());
  } catch (error) {
    ctx.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (typeof flags.code === "string") return finishCodeFlow(ctx, flags.code);
  if (flags.paste) return pasteKey(ctx, base);

  const mode = chooseLoginMode(flags, ctx);
  const preflight = await loginPreflight(base, ctx.fetch, ctx.userAgent);
  if (preflight.kind === "unavailable") {
    ctx.err(unavailable(base));
    return 2;
  }
  if (preflight.kind === "unreachable") {
    ctx.err(`Could not reach ${base} to sign in (${preflight.detail}).`);
    return 7;
  }
  const device = deviceName();
  const noBrowser = Boolean(flags["no-browser"]);

  if (mode === "background") {
    let started;
    try {
      started = await startBackgroundLogin({ baseUrl: base, device, env: ctx.env });
    } catch (error) {
      ctx.err(`${error instanceof Error ? error.message : "The sign-in listener did not start."} Run \`trendsfast login --code-flow\` instead.`);
      return 7;
    }
    ctx.out(`Open this address in a browser to sign in (it stays valid for 10 minutes):\n${started.url}`);
    if (!noBrowser) (ctx.io.openBrowser ?? ((url) => openBrowser(url, ctx.io)))(started.url);
    ctx.out("The sign-in is waiting in the background. When you have finished in the browser, run `trendsfast whoami` to confirm.");
    return 0;
  }

  if (mode === "code") {
    const keys = generateLoginKeyPair();
    const state = generateLoginState();
    const loginId = randomUUID();
    const expiresAt = new Date(now.getTime() + loginTimeoutMs(ctx.env)).toISOString();
    const exportedKey = exportPrivateKey(keys.privateKey);
    writePendingCodeLogin(ctx.env, {
      version: 1,
      login_id: loginId,
      base_url: base,
      state,
      public_key: keys.publicKey,
      private_key: exportedKey,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    });
    writeLoginStatus(ctx.env, {
      version: 1,
      login_id: loginId,
      mode: "code",
      status: "waiting",
      pid: null,
      base_url: base,
      started_at: now.toISOString(),
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    });
    const url = authorizeUrl(base, { callback: "oob", state, publicKey: keys.publicKey, device });
    ctx.out(`Open this address in any browser and sign in (it stays valid for 10 minutes):\n${url}`);
    if (!noBrowser && hasDisplay(ctx.io)) (ctx.io.openBrowser ?? ((u) => openBrowser(u, ctx.io)))(url);
    ctx.out(
      "TrendsFast then shows a code. Finish here with:\n  trendsfast login --code <code>\nThe code is sealed to this machine: it opens only with a private key kept here, so it is safe to pass along, for example through an agent's chat.",
    );
    return 0;
  }

  // Foreground: a person at a terminal waits here.
  const session = await startLoopbackSession({ baseUrl: base, device });
  const loginId = randomUUID();
  const timeoutMs = loginTimeoutMs(ctx.env);
  writeLoginStatus(ctx.env, {
    version: 1,
    login_id: loginId,
    mode: "foreground",
    status: "waiting",
    pid: process.pid,
    base_url: base,
    started_at: now.toISOString(),
    expires_at: new Date(now.getTime() + timeoutMs).toISOString(),
    updated_at: now.toISOString(),
  });
  ctx.out(`Open this address in a browser to sign in (it stays valid for 10 minutes):\n${session.url}`);
  if (!noBrowser) (ctx.io.openBrowser ?? ((url) => openBrowser(url, ctx.io)))(session.url);
  ctx.err("Waiting for the browser (up to 10 minutes; an agent should run `trendsfast login --background` instead)…");
  const outcome = await session.wait(timeoutMs);
  const finished = ctx.io.now();
  if (outcome.kind === "signed_in") {
    const stored = storeCredential(ctx.env, outcome.credential, base, finished);
    updateLoginStatus(ctx.env, loginId, { status: "signed_in", pid: null, project_name: stored.project_name ?? "", key_expires_at: stored.expires_at }, finished);
    ctx.out(signedInLine(stored.project_name, stored.expires_at));
    return 0;
  }
  updateLoginStatus(ctx.env, loginId, { status: outcome.kind, pid: null, ...(outcome.kind === "failed" ? { reason: outcome.reason } : {}) }, finished);
  ctx.err(
    outcome.kind === "cancelled"
      ? "The sign-in was cancelled in the browser; nothing was created."
      : outcome.kind === "expired"
        ? "The sign-in did not finish within 10 minutes. Run `trendsfast login` again."
        : `The sign-in could not be completed (${outcome.reason}). Run \`trendsfast login\` again.`,
  );
  return 2;
}

async function finishCodeFlow(ctx: Context, code: string): Promise<number> {
  const now = ctx.io.now();
  const pending = readPendingCodeLogin(ctx.env, now);
  if (!pending) {
    ctx.err("No sign-in is waiting on this machine, or it is older than 10 minutes. Run `trendsfast login --code-flow` and use the new code.");
    return 2;
  }
  let credential;
  try {
    credential = openCliCredential(importPrivateKey(pending.private_key), pending.public_key, pending.state, code);
  } catch (error) {
    ctx.err(
      error instanceof SealError && (error.reason === "decrypt" || error.reason === "public_key" || error.reason === "low_order")
        ? "This code does not match the sign-in waiting on this machine; it may belong to an earlier `trendsfast login`. Use the code from the most recent address, or run `trendsfast login --code-flow` again."
        : "That is not a complete sign-in code. Copy the whole code the browser shows and run `trendsfast login --code <code>` again.",
    );
    return 2;
  }
  const stored = storeCredential(ctx.env, credential, pending.base_url, now);
  deletePendingCodeLogin(ctx.env);
  updateLoginStatus(ctx.env, pending.login_id, { status: "signed_in", project_name: stored.project_name ?? "", key_expires_at: stored.expires_at }, now);
  ctx.out(signedInLine(stored.project_name, stored.expires_at));
  return 0;
}

async function pasteKey(ctx: Context, base: string): Promise<number> {
  let key: string;
  try {
    key = await readSecretLine(ctx.io, "Paste your TrendsFast API key (it is not shown): ");
  } catch {
    ctx.err("Cancelled; nothing was stored.");
    return 1;
  }
  if (!API_KEY_PATTERN.test(key)) {
    ctx.err(`That is not a TrendsFast API key. Create one at ${API_KEYS_URL}; nothing was stored.`);
    return 1;
  }
  let status = 0;
  try {
    const response = await ctx.fetch(new URL("/v3/trends/wallet", base), {
      headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": ctx.userAgent },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    await response.arrayBuffer().catch(() => undefined);
  } catch {
    ctx.err(`Could not reach ${base} to check the key; nothing was stored.`);
    return 7;
  }
  if (status === 401) {
    ctx.err("TrendsFast did not accept that key: it is invalid, expired or revoked. Nothing was stored.");
    return 2;
  }
  if (status !== 200 && status !== 403) {
    ctx.err(`TrendsFast answered HTTP ${status} while checking the key; nothing was stored.`);
    return 7;
  }
  writeStoredCredentials(
    { api_key: key, key_id: null, project_id: null, project_name: null, scopes: null, expires_at: null, base_url: base, created_at: ctx.io.now().toISOString() },
    credentialsPath(ctx.env),
  );
  ctx.out(`Stored key ${keyPrefix(key)} for ${base}; TrendsFast accepted it.`);
  if (status === 403) ctx.err("The key may not read the credit balance (credits:read); some free reads will be refused.");
  return 0;
}

export function loginStatus(ctx: Context): number {
  const now = ctx.io.now();
  const stored = readStoredCredentials(credentialsPath(ctx.env));
  const status = effectiveLoginStatus(ctx.env, now);
  const pending = readPendingCodeLogin(ctx.env, now);
  if (status) {
    const until = `until ${status.expires_at.slice(11, 16)} UTC`;
    const line =
      status.status === "waiting"
        ? status.mode === "code"
          ? `Waiting for sign-in (${until}): finish with \`trendsfast login --code <code>\`.`
          : `Waiting for sign-in in the browser (${until}).`
        : status.status === "signed_in"
          ? signedInLine(status.project_name ?? null, status.key_expires_at ?? null)
          : status.status === "cancelled"
            ? "The last sign-in was cancelled in the browser."
            : status.status === "expired"
              ? "The last sign-in expired before it finished. Run `trendsfast login` again."
              : `The last sign-in failed (${status.reason ?? "unknown"}). Run \`trendsfast login\` again.`;
    ctx.out(line);
  } else if (!pending) ctx.out("No sign-in has been started on this machine.");
  ctx.out(stored ? `A key is stored: ${keyPrefix(stored.api_key)} for ${stored.base_url}.` : "No key is stored.");
  return stored || ctx.env.TRENDSFAST_API_KEY ? 0 : 2;
}

/** `trendsfast logout`: forget the stored key and any sign-in still waiting. */
export function logout(ctx: Context): number {
  const path = credentialsPath(ctx.env);
  const removed = deleteFile(path);
  deletePendingCodeLogin(ctx.env);
  deleteFile(statusPath(ctx.env));
  ctx.out(
    removed
      ? `Removed the stored key from ${path}. The key itself works until it expires or you revoke it at ${API_KEYS_URL}.`
      : "No key was stored on this machine.",
  );
  if (ctx.env.TRENDSFAST_API_KEY) ctx.err("TRENDSFAST_API_KEY is still set in this environment and is still used.");
  return 0;
}
