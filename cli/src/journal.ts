/**
 * Every paid call's request ID, written before the call is sent, at
 * `${XDG_STATE_HOME:-~/.local/state}/trendsfast/requests/<uuid>.json`. If the process dies or
 * the answer is lost, the ID is still on disk for `trendsfast request <uuid>`. No key, no
 * response body: the ID, what was asked, the cap and how it ended.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stateDirectory, writePrivateJson, type Env } from "./sdk/credentials.js";

export interface JournalEntry {
  version: 1;
  request_id: string;
  command: string;
  operation: string;
  product: string | null;
  max_credits: number;
  base_url: string;
  created_at: string;
  updated_at: string;
  status: "sending" | "completed" | "unconfirmed" | "refused";
  result_id?: string;
  credits_charged?: number;
  replayed?: boolean;
  error?: string;
}

export function journalPath(env: Env, requestId: string): string {
  return join(stateDirectory(env), "requests", `${requestId}.json`);
}

export function writeJournal(env: Env, entry: JournalEntry): void {
  writePrivateJson(journalPath(env, entry.request_id), entry);
}

export function readJournal(env: Env, requestId: string): JournalEntry | null {
  try {
    return JSON.parse(readFileSync(journalPath(env, requestId), "utf8")) as JournalEntry;
  } catch {
    return null;
  }
}

export function updateJournal(env: Env, requestId: string, update: Partial<JournalEntry>, now: Date): void {
  const current = readJournal(env, requestId);
  if (!current) return;
  writeJournal(env, { ...current, ...update, updated_at: now.toISOString() });
}
