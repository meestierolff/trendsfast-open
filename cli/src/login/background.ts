/**
 * `trendsfast login --background`: the listener outlives the command.
 *
 * Agents run commands under shell timeouts (two minutes is common) and a person may take
 * longer to sign in. If the CLI process died, the loopback listener would die with it and
 * the browser's redirect would land nowhere. So the foreground command starts a detached
 * child that owns the key pair and the listener for the sign-in's full ten minutes, prints
 * the address it receives from the child over IPC, and exits at once. The child inherits no
 * stdio, writes nothing to any stream or log, stores the key when the browser returns, and
 * exits after success, cancel or expiry. Its progress is in login-status.json, which never
 * holds a secret.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Env } from "../sdk/credentials.js";
import { LOGIN_TIMEOUT_MS, startLoopbackSession } from "./session.js";
import { readLoginStatus, updateLoginStatus, writeLoginStatus } from "./state.js";
import { storeCredential } from "./store.js";

const CLI_ENTRY = fileURLToPath(new URL("../cli.js", import.meta.url));
export const LISTENER_COMMAND = "__login-listener";

/** Ten minutes, or less for tests through TRENDSFAST_LOGIN_TIMEOUT_MS; never more. */
export function loginTimeoutMs(env: Env): number {
  const requested = Number(env.TRENDSFAST_LOGIN_TIMEOUT_MS);
  return Number.isFinite(requested) && requested > 0 ? Math.min(requested, LOGIN_TIMEOUT_MS) : LOGIN_TIMEOUT_MS;
}

type Ready = { type: "ready"; url: string; login_id: string; expires_at: string } | { type: "error"; reason: string };

/** Starts the detached listener and returns its sign-in address. */
export function startBackgroundLogin(options: {
  baseUrl: string;
  device: string | undefined;
  env: Env;
}): Promise<{ url: string; loginId: string; expiresAt: string; pid: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI_ENTRY, LISTENER_COMMAND, "--base-url", options.baseUrl, ...(options.device ? ["--device", options.device] : [])],
      {
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...options.env } as NodeJS.ProcessEnv,
        windowsHide: true,
      },
    );
    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error("The sign-in listener did not start."));
    }, 15_000);
    const cleanup = () => {
      clearTimeout(timer);
      child.removeAllListeners("message");
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("exit", () => {
      cleanup();
      reject(new Error("The sign-in listener stopped before it was ready."));
    });
    child.on("message", (message: Ready) => {
      cleanup();
      if (message.type !== "ready") {
        child.kill();
        reject(new Error(`The sign-in listener could not start (${message.reason}).`));
        return;
      }
      if (child.connected) child.disconnect();
      child.unref();
      resolve({ url: message.url, loginId: message.login_id, expiresAt: message.expires_at, pid: child.pid ?? 0 });
    });
  });
}

/** The detached child. Runs silently; every outcome goes to login-status.json. */
export async function runLoginListener(options: { baseUrl: string; device: string | undefined; env: Env }): Promise<number> {
  const send = (message: Ready) => {
    try {
      process.send?.(message);
    } catch {
      // The parent is gone; the status file still tells the story.
    }
  };
  const loginId = randomUUID();
  const timeoutMs = loginTimeoutMs(options.env);
  let session;
  try {
    session = await startLoopbackSession({ baseUrl: options.baseUrl, device: options.device });
  } catch {
    send({ type: "error", reason: "listen" });
    return 1;
  }
  const started = new Date();
  const expiresAt = new Date(started.getTime() + timeoutMs).toISOString();
  writeLoginStatus(options.env, {
    version: 1,
    login_id: loginId,
    mode: "background",
    status: "waiting",
    pid: process.pid,
    base_url: options.baseUrl,
    started_at: started.toISOString(),
    expires_at: expiresAt,
    updated_at: started.toISOString(),
  });
  // The parent disconnects once it has the address; the child never writes to a stream.
  send({ type: "ready", url: session.url, login_id: loginId, expires_at: expiresAt });

  // A newer sign-in, or `trendsfast logout`, replaces or removes the status: then stop.
  const watcher = setInterval(() => {
    const status = readLoginStatus(options.env);
    if (!status || status.login_id !== loginId || status.status !== "waiting") session.close();
  }, 1000);
  const outcome = await session.wait(timeoutMs);
  clearInterval(watcher);
  const now = new Date();
  if (outcome.kind === "signed_in") {
    const stored = storeCredential(options.env, outcome.credential, options.baseUrl, now);
    updateLoginStatus(options.env, loginId, { status: "signed_in", pid: null, project_name: stored.project_name ?? "", key_expires_at: stored.expires_at }, now);
  } else if (outcome.kind === "cancelled") updateLoginStatus(options.env, loginId, { status: "cancelled", pid: null }, now);
  else if (outcome.kind === "expired") updateLoginStatus(options.env, loginId, { status: "expired", pid: null }, now);
  else if (outcome.reason !== "closed") updateLoginStatus(options.env, loginId, { status: "failed", pid: null, reason: outcome.reason }, now);
  return 0;
}
