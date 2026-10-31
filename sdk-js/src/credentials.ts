/**
 * The key `trendsfast login` stores, at `${XDG_CONFIG_HOME:-~/.config}/trendsfast/credentials.json`
 * (directory 0700, file 0600). The SDK reads it after `TRENDSFAST_API_KEY`; only the CLI
 * writes it. The key is never logged or printed: only its visible prefix may be shown.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type Env = Readonly<Record<string, string | undefined>>;

export interface StoredCredentials {
  api_key: string;
  key_id: string | null;
  project_id: string | null;
  project_name: string | null;
  scopes: string[] | null;
  expires_at: string | null;
  base_url: string;
  created_at: string;
}

export function homeDirectory(env: Env = process.env): string {
  return env.HOME || env.USERPROFILE || homedir();
}

/** `${XDG_CONFIG_HOME:-~/.config}/trendsfast` */
export function configDirectory(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homeDirectory(env), ".config");
  return join(base, "trendsfast");
}

/** `${XDG_STATE_HOME:-~/.local/state}/trendsfast` */
export function stateDirectory(env: Env = process.env): string {
  const base = env.XDG_STATE_HOME?.trim() || join(homeDirectory(env), ".local", "state");
  return join(base, "trendsfast");
}

export function credentialsPath(env: Env = process.env): string {
  return join(configDirectory(env), "credentials.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const optionalString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** The stored credentials, or null when there are none or the file is unreadable. */
export function readStoredCredentials(path: string = credentialsPath()): StoredCredentials | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.api_key !== "string" || !raw.api_key) return null;
  return {
    api_key: raw.api_key,
    key_id: optionalString(raw.key_id),
    project_id: optionalString(raw.project_id),
    project_name: optionalString(raw.project_name),
    scopes: Array.isArray(raw.scopes) ? raw.scopes.filter((s): s is string => typeof s === "string") : null,
    expires_at: optionalString(raw.expires_at),
    base_url: optionalString(raw.base_url) ?? "https://trendsfast.com",
    created_at: optionalString(raw.created_at) ?? "",
  };
}

/** Writes a private JSON file: its directory 0700, the file 0600, replaced atomically. */
export function writePrivateJson(path: string, value: unknown): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Not every filesystem keeps POSIX modes (Windows); the file is still the user's own.
  }
  const temporary = join(directory, `.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(temporary, 0o600);
  } catch {
    // See above.
  }
  renameSync(temporary, path);
}

export function writeStoredCredentials(credentials: StoredCredentials, path: string = credentialsPath()): void {
  writePrivateJson(path, credentials);
}

export function deleteFile(path: string): boolean {
  try {
    statSync(path);
  } catch {
    return false;
  }
  rmSync(path, { force: true });
  return true;
}

/** `tf_live_AbCd1234` from a full key: the part TrendsFast's dashboard shows. */
export function keyPrefix(apiKey: string): string {
  const match = /^(tf_(?:test|live)_[A-Za-z0-9_-]{8,32})\./.exec(apiKey);
  // Anything else is not a TrendsFast key; showing part of it could show part of a secret.
  return match ? match[1]! : "(not a TrendsFast key)";
}
