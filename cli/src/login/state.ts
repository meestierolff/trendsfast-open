/**
 * Two small files beside the credentials, both 0600:
 *
 * - `login-status.json` says how the last sign-in that did not wait in the foreground is
 *   going: waiting, signed in, cancelled, expired or failed. It never holds a key, a state or
 *   a private key, so `whoami` and `login --status` can read it freely.
 * - `login-pending.json` holds a code-flow sign-in's private key and state until the code
 *   arrives. It is deleted when the sign-in completes, and by any later command once its
 *   ten minutes have passed: after that the server can no longer seal a key to it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configDirectory, deleteFile, writePrivateJson, type Env } from "../sdk/credentials.js";

export type LoginStatusValue = "waiting" | "signed_in" | "cancelled" | "expired" | "failed";

export interface LoginStatus {
  version: 1;
  login_id: string;
  mode: "foreground" | "background" | "code";
  status: LoginStatusValue;
  pid: number | null;
  base_url: string;
  started_at: string;
  expires_at: string;
  updated_at: string;
  project_name?: string;
  key_expires_at?: string | null;
  reason?: string;
}

export interface PendingCodeLogin {
  version: 1;
  login_id: string;
  base_url: string;
  state: string;
  public_key: string;
  private_key: { d: string; x: string };
  created_at: string;
  expires_at: string;
}

export const statusPath = (env: Env) => join(configDirectory(env), "login-status.json");
export const pendingPath = (env: Env) => join(configDirectory(env), "login-pending.json");

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function readLoginStatus(env: Env): LoginStatus | null {
  const status = readJson<LoginStatus>(statusPath(env));
  return status && status.version === 1 && typeof status.status === "string" ? status : null;
}

export function writeLoginStatus(env: Env, status: LoginStatus): void {
  writePrivateJson(statusPath(env), status);
}

/** Updates the status only while it still belongs to this sign-in. */
export function updateLoginStatus(env: Env, loginId: string, update: Partial<LoginStatus>, now: Date): boolean {
  const current = readLoginStatus(env);
  if (!current || current.login_id !== loginId) return false;
  writeLoginStatus(env, { ...current, ...update, updated_at: now.toISOString() });
  return true;
}

function alive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The status as it stands now: a "waiting" sign-in past its expiry, or whose listener is
 * gone, is reported as expired. */
export function effectiveLoginStatus(env: Env, now: Date): LoginStatus | null {
  const status = readLoginStatus(env);
  if (!status) return null;
  if (status.status !== "waiting") return status;
  const pastExpiry = Date.parse(status.expires_at) <= now.getTime();
  const listenerGone = status.mode !== "code" && !alive(status.pid);
  return pastExpiry || listenerGone ? { ...status, status: "expired" } : status;
}

export function readPendingCodeLogin(env: Env, now: Date): PendingCodeLogin | null {
  const pending = readJson<PendingCodeLogin>(pendingPath(env));
  if (!pending || pending.version !== 1) return null;
  if (Date.parse(pending.expires_at) <= now.getTime()) {
    deleteFile(pendingPath(env));
    return null;
  }
  return pending;
}

export function writePendingCodeLogin(env: Env, pending: PendingCodeLogin): void {
  writePrivateJson(pendingPath(env), pending);
}

export function deletePendingCodeLogin(env: Env): void {
  deleteFile(pendingPath(env));
}

/** Removes a code-flow file whose ten minutes have passed. Cheap; run on every command. */
export function sweepExpiredPending(env: Env, now: Date): void {
  readPendingCodeLogin(env, now);
}
