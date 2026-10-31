// Shared test helpers. Tests run offline against the built package in dist/: every HTTP
// call goes to a fake fetch that records what would have been sent.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const dist = new URL("../dist/index.js", import.meta.url);
if (!existsSync(fileURLToPath(dist))) throw new Error('Missing dist/: run "npm run build" first');
export const sdk = await import(dist.href);

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

export const KEY = "tf_test_Fixture1.fixture-only-key-not-for-production-000000000000";
export const CONTEXT_ID = "44444444-4444-4444-8444-444444444444";

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fake fetch. `handler(call, index)` answers each call; every call is recorded with its
 * parsed body. A handler may throw to stand for a network failure. */
export function fakeFetch(handler) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const call = {
      method: init.method ?? "GET",
      url,
      path: url.pathname,
      headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      body: init.body ? JSON.parse(init.body) : undefined,
      redirect: init.redirect,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch, calls };
}

export function client(fetch, options = {}) {
  return new sdk.TrendsFast({
    apiKey: KEY,
    fetch,
    env: {},
    sleep: async () => {},
    ...options,
  });
}

export const contextBody = {
  version: "trend-context-v3",
  context: {
    kind: "CONFIRMED_CONTEXT",
    context_id: CONTEXT_ID,
    revision: 3,
    fields: [{ field: "description", value: "Invoicing for freelancers", basis: "OWNER_CONFIRMED", evidence_ids: [] }],
  },
};

/** A saved result answering `call`, with the request ID and operation the call carried. */
export function resultFor(call, name = "customers-result.json") {
  const result = fixture(name);
  result.request_id = call.body?.request_id ?? call.path.split("/").pop();
  result.operation = call.body ? call.path.split("/").pop() : result.operation;
  return result;
}
