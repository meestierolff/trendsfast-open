import { credentialsPath, writeStoredCredentials, type Env, type StoredCredentials } from "../sdk/credentials.js";
import type { CliCredential } from "./seal.js";

/** Saves what a sign-in returned, 0600, and returns what was saved. */
export function storeCredential(env: Env, credential: CliCredential, baseUrl: string, now: Date): StoredCredentials {
  const stored: StoredCredentials = {
    api_key: credential.api_key,
    key_id: credential.key_id,
    project_id: credential.project_id,
    project_name: credential.project_name,
    scopes: credential.scopes,
    expires_at: credential.expires_at,
    base_url: baseUrl,
    created_at: now.toISOString(),
  };
  writeStoredCredentials(stored, credentialsPath(env));
  return stored;
}

export function signedInLine(projectName: string | null, expiresAt: string | null): string {
  const project = projectName ?? "your TrendsFast project";
  return expiresAt
    ? `Signed in to ${project}; key expires ${expiresAt.slice(0, 10)}.`
    : `Signed in to ${project}; the key has no expiry date.`;
}
