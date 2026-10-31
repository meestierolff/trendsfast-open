// Test helpers. Everything runs offline: the CLI's main() in-process with fake streams and
// a fake fetch, or the built CLI as a child process against a local HTTP server. Every test
// gets its own temporary HOME and XDG directories, so no real agent folder is touched.
import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
export const cliPath = join(packageRoot, "dist", "cli.js");
if (!existsSync(cliPath)) throw new Error('Missing dist/: run "npm run build" first');
export const { main } = await import(new URL("../dist/main.js", import.meta.url).href);
export const seal = await import(new URL("../dist/login/seal.js", import.meta.url).href);

export const KEY = "tf_test_Fixture1.fixture-only-key-not-for-production-000000000000";
export const CONTEXT_ID = "44444444-4444-4444-8444-444444444444";

export function fixture(name) {
  return JSON.parse(readFileSync(join(packageRoot, "..", "sdk-js", "test", "fixtures", name), "utf8"));
}

/** A fresh HOME with XDG directories inside it. */
export function tempHome() {
  const home = mkdtempSync(join(tmpdir(), "tf-cli-"));
  return {
    home,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      PATH: process.env.PATH,
    },
  };
}

class Capture {
  constructor(isTTY) {
    this.text = "";
    this.isTTY = isTTY;
  }
  write(chunk) {
    this.text += chunk;
    return true;
  }
}

/** Runs `trendsfast <argv>` in-process. Returns { code, stdout, stderr }. */
export async function run(argv, { env, fetch, tty = false, stdinText, openBrowser, cwd, now, ref } = {}) {
  const stdin = new PassThrough();
  stdin.isTTY = tty;
  if (tty) stdin.setRawMode = () => stdin;
  if (stdinText !== undefined) stdin.end(stdinText);
  const stdout = new Capture(tty);
  const stderr = new Capture(tty);
  if (ref) Object.assign(ref, { stdout, stderr });
  const io = {
    stdout,
    stderr,
    stdin,
    env: env ?? tempHome().env,
    cwd: cwd ?? mkdtempSync(join(tmpdir(), "tf-cwd-")),
    platform: process.platform,
    now: now ?? (() => new Date()),
    ...(fetch ? { fetch } : {}),
    ...(openBrowser ? { openBrowser } : {}),
  };
  const code = await main(argv, io);
  return { code, stdout: stdout.text, stderr: stderr.text, io };
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A fake fetch. `handler(call, index)` answers; calls are recorded with parsed bodies. */
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
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch, calls };
}

export const contextBody = {
  version: "trend-context-v3",
  context: {
    kind: "CONFIRMED_CONTEXT",
    context_id: CONTEXT_ID,
    revision: 3,
    fields: [{ field: "description", value: "Invoicing for freelance designers", basis: "OWNER_CONFIRMED", evidence_ids: [] }],
  },
};

export const walletBody = {
  version: "credit-wallet-v3",
  accountId: "11111111-1111-4111-8111-111111111111",
  available: 90,
  free: 90,
  monthly: 0,
  prepaid: 0,
  reserved: 0,
  consumed: 10,
  debt: 0,
  paused: false,
  lots: [],
};

export function quoteBody(operation, credits) {
  return { version: "trends-credit-quote-v3", operation, credits, max_credits: credits, catalog_version: "fixture", new_research: false, available: true };
}

/** A fake API: free reads answered from fixtures, paid calls by `paid(call)`. */
export function api({ paid, price = 10, context = contextBody } = {}) {
  return fakeFetch((call, index) => {
    if (call.path === "/v3/trends/quote") return json(quoteBody(call.url.searchParams.get("operation"), price));
    if (call.path === "/v3/trends/context") return json(context);
    if (call.path === "/v3/trends/wallet") return json(walletBody);
    if (call.method === "POST") return paid ? paid(call, index) : json(resultFor(call));
    if (call.path.startsWith("/v3/trends/requests/")) return json(resultFor(call));
    return json({ error: "NOT_FOUND" }, 404);
  });
}

export function resultFor(call, name = "customers-result.json") {
  const result = fixture(name);
  if (call.body) {
    result.request_id = call.body.request_id;
    result.operation = call.path.split("/").pop();
  } else result.request_id = call.path.split("/").pop();
  return result;
}

/** What TrendsFast's server does after the owner approves: seal the credential to the
 * CLI's public key, written here from the version-1 specification. */
export function sealCredential(publicKey, state, credential) {
  const ephemeral = generateKeyPairSync("x25519");
  const recipient = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: publicKey }, format: "jwk" });
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const ephemeralRaw = Buffer.from(ephemeral.publicKey.export({ format: "jwk" }).x, "base64url");
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeralRaw, Buffer.from(publicKey, "base64url")]), "trendsfast-cli-login-v1", 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(state, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), ephemeralRaw, nonce, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

export const credential = {
  v: 1,
  api_key: KEY,
  key_id: "55555555-5555-4555-8555-555555555555",
  project_id: "11111111-1111-4111-8111-111111111111",
  project_name: "Fixture Studio",
  scopes: ["trends:query", "trends:read", "credits:read"],
  expires_at: "2027-01-27T00:00:00.000Z",
};

/** A local stand-in for trendsfast.com's sign-in pre-flight, for the spawned CLI. */
export async function loginServer({ enabled = true } = {}) {
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/auth/cli/authorize")) {
      response.writeHead(enabled ? 400 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: enabled ? "invalid_request" : "CLI_LOGIN_UNAVAILABLE" }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Plays the browser: approves the sign-in at `authorizeUrl` and follows the redirect to the
 * CLI's loopback callback. Returns the callback's status and body. */
export async function approveInBrowser(authorizeUrl, { cred = credential, state: overrideState, error } = {}) {
  const url = new URL(authorizeUrl);
  const callback = url.searchParams.get("callback");
  const state = overrideState ?? url.searchParams.get("state");
  const target = new URL(callback);
  target.searchParams.set("state", state);
  if (error) target.searchParams.set("error", error);
  else target.searchParams.set("sealed", sealCredential(url.searchParams.get("public_key"), url.searchParams.get("state"), cred));
  const response = await fetch(target);
  return { status: response.status, body: await response.text() };
}

export async function waitFor(check, { timeoutMs = 10_000, intervalMs = 50 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
