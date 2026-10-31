/** Whether this deployment offers browser sign-in: `GET /auth/cli/authorize` with no
 * parameters answers 400 when it does, and 404 `CLI_LOGIN_UNAVAILABLE` when it is off. */
import { LOGIN_AUTHORIZE_PATH } from "./session.js";

export type Preflight = { kind: "enabled" } | { kind: "unavailable" } | { kind: "unreachable"; detail: string };

export async function loginPreflight(baseUrl: string, fetchImpl: typeof globalThis.fetch, userAgent: string): Promise<Preflight> {
  try {
    const response = await fetchImpl(new URL(LOGIN_AUTHORIZE_PATH, baseUrl), {
      method: "GET",
      headers: { accept: "application/json", "user-agent": userAgent },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    await response.arrayBuffer().catch(() => undefined);
    if (response.status === 400) return { kind: "enabled" };
    if (response.status === 404) return { kind: "unavailable" };
    return { kind: "unreachable", detail: `HTTP ${response.status}` };
  } catch (error) {
    return { kind: "unreachable", detail: error instanceof Error ? error.message : "no answer" };
  }
}
