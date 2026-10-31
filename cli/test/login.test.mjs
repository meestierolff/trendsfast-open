import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  KEY,
  approveInBrowser,
  cliPath,
  credential,
  fakeFetch,
  json,
  loginServer,
  run,
  seal,
  sealCredential,
  tempHome,
  waitFor,
} from "./helpers.mjs";

const credentialsFile = (env) => join(env.XDG_CONFIG_HOME, "trendsfast", "credentials.json");
const statusFile = (env) => join(env.XDG_CONFIG_HOME, "trendsfast", "login-status.json");
const pendingFile = (env) => join(env.XDG_CONFIG_HOME, "trendsfast", "login-pending.json");
const mode = (path) => (statSync(path).mode & 0o777).toString(8);
const preflight = (status = 400) => fakeFetch(() => json({ error: status === 400 ? "invalid_request" : "CLI_LOGIN_UNAVAILABLE" }, status));

describe("the sealed credential (version 1)", () => {
  it("opens what the server's scheme seals, and only for the same state and key pair", () => {
    const keys = seal.generateLoginKeyPair();
    const state = seal.generateLoginState();
    assert.match(keys.publicKey, /^[A-Za-z0-9_-]{43}$/);
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    const sealed = sealCredential(keys.publicKey, state, credential);
    assert.deepEqual(seal.openCliCredential(keys.privateKey, keys.publicKey, state, sealed), credential);
    assert.throws(() => seal.openCliCredential(keys.privateKey, keys.publicKey, `${state}x`, sealed), (e) => e.reason === "decrypt");
    const other = seal.generateLoginKeyPair();
    assert.throws(() => seal.openCliCredential(other.privateKey, other.publicKey, state, sealed), (e) => e.reason === "decrypt");
    const bytes = Buffer.from(sealed, "base64url");
    bytes[0] = 2;
    assert.throws(() => seal.openCliCredential(keys.privateKey, keys.publicKey, state, bytes.toString("base64url")), (e) => e.reason === "version");
    assert.throws(() => seal.openCliCredential(keys.privateKey, keys.publicKey, state, "not base64!"), (e) => e.reason === "malformed");
    // A low-order point as the ephemeral key would give an all-zero secret anyone could compute.
    const lowOrder = Buffer.concat([Buffer.from([1]), Buffer.alloc(32), Buffer.alloc(12), Buffer.alloc(20)]).toString("base64url");
    assert.throws(() => seal.openCliCredential(keys.privateKey, keys.publicKey, state, lowOrder), (e) => ["low_order", "public_key"].includes(e.reason));
  });
});

describe("trendsfast login in the foreground", () => {
  it("prints the address before opening the browser, sends exactly four parameters, and stores the key 0600", async () => {
    const { env } = tempHome();
    const { fetch } = preflight();
    let printedFirst = false;
    let authorize;
    const ref = {};
    const result = await run(["login", "--foreground", "--base-url", "https://trendsfast.example"], {
      env,
      fetch,
      ref,
      openBrowser: (url) => {
        authorize = url;
        printedFirst = ref.stdout.text.includes(url);
        setTimeout(async () => {
          // A stray redirect with the wrong state is refused, and the login keeps waiting.
          const wrong = await approveInBrowser(url, { state: "A".repeat(43) });
          assert.equal(wrong.status, 400);
          const right = await approveInBrowser(url);
          assert.equal(right.status, 200);
          assert.match(right.body, /Signed in\. You can close this tab\./);
          assert.ok(!right.body.includes(KEY), "the page carries no secret");
        }, 10);
        return true;
      },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(printedFirst);
    const url = new URL(authorize);
    assert.equal(`${url.origin}${url.pathname}`, "https://trendsfast.example/auth/cli/authorize");
    const keys = [...url.searchParams.keys()];
    assert.equal(new Set(keys).size, keys.length, "no parameter repeats");
    assert.deepEqual(keys.filter((key) => !["callback", "state", "public_key", "device"].includes(key)), []);
    for (const key of ["callback", "state", "public_key"]) assert.ok(keys.includes(key), key);
    assert.match(url.searchParams.get("callback"), /^http:\/\/127\.0\.0\.1:\d{4,5}\/callback$/);
    assert.match(url.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
    assert.match(url.searchParams.get("public_key"), /^[A-Za-z0-9_-]{43}$/);
    assert.match(result.stdout, /Open this address/);
    assert.ok(result.stdout.indexOf("http") < result.stdout.indexOf("Signed in to Fixture Studio"));
    assert.match(result.stdout, /Signed in to Fixture Studio; key expires 2027-01-27\./);
    assert.ok(!result.stdout.includes(KEY) && !result.stderr.includes(KEY), "the key is never printed");
    const stored = JSON.parse(readFileSync(credentialsFile(env), "utf8"));
    assert.deepEqual(Object.keys(stored).sort(), ["api_key", "base_url", "created_at", "expires_at", "key_id", "project_id", "project_name", "scopes"]);
    assert.equal(stored.api_key, KEY);
    assert.equal(stored.base_url, "https://trendsfast.example");
    assert.equal(mode(credentialsFile(env)), "600");
    assert.equal(mode(join(env.XDG_CONFIG_HOME, "trendsfast")), "700");
  });

  it("ends with exit 2 when the owner cancels, storing nothing", async () => {
    const { env } = tempHome();
    const result = await run(["login", "--foreground", "--base-url", "https://trendsfast.example"], {
      env,
      fetch: preflight().fetch,
      openBrowser: (url) => {
        setTimeout(() => approveInBrowser(url, { error: "access_denied" }), 10);
        return true;
      },
    });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /cancelled/);
    assert.ok(!existsSync(credentialsFile(env)));
  });

  it("explains how to paste a key when browser sign-in is switched off", async () => {
    const result = await run(["login", "--foreground"], { fetch: preflight(404).fetch });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /dashboard\/api-keys/);
    assert.match(result.stderr, /trendsfast login --paste/);
  });

  it("names the device with letters, digits and ._'()- only, at most 64 characters", async () => {
    const { deviceName } = await import(new URL("../dist/login/session.js", import.meta.url).href);
    assert.equal(deviceName("Mees-MacBook-Pro.local"), "Mees-MacBook-Pro.local");
    assert.equal(deviceName("  büro\t pc #1  "), "büro- pc -1");
    assert.equal(deviceName("x".repeat(80)).length, 64);
    assert.equal(deviceName("   "), undefined);
  });
});

describe("trendsfast login --code-flow", () => {
  it("prints an oob address, keeps the private key 0600, and --code finishes the sign-in", async () => {
    const { env } = tempHome();
    const started = await run(["login", "--code-flow", "--no-browser", "--base-url", "https://trendsfast.example"], { env, fetch: preflight().fetch });
    assert.equal(started.code, 0, started.stderr);
    const authorize = new URL(started.stdout.match(/https:\/\/\S+/)[0]);
    assert.equal(authorize.searchParams.get("callback"), "oob");
    assert.match(started.stdout, /trendsfast login --code <code>/);
    assert.equal(mode(pendingFile(env)), "600");
    const status = readFileSync(statusFile(env), "utf8");
    assert.ok(!status.includes(authorize.searchParams.get("state")), "the status file holds no state");

    const code = sealCredential(authorize.searchParams.get("public_key"), authorize.searchParams.get("state"), credential);
    const wrong = await run(["login", "--code", sealCredential(seal.generateLoginKeyPair().publicKey, "x".repeat(43), credential)], { env });
    assert.equal(wrong.code, 2);
    assert.match(wrong.stderr, /does not match/);
    assert.ok(existsSync(pendingFile(env)), "a wrong code leaves the sign-in waiting");

    const finished = await run(["login", "--code", code], { env });
    assert.equal(finished.code, 0, finished.stderr);
    assert.match(finished.stdout, /Signed in to Fixture Studio/);
    assert.equal(JSON.parse(readFileSync(credentialsFile(env), "utf8")).api_key, KEY);
    assert.ok(!existsSync(pendingFile(env)), "the pending private key is deleted");
    assert.equal(JSON.parse(readFileSync(statusFile(env), "utf8")).status, "signed_in");
  });

  it("forgets a pending sign-in after its ten minutes", async () => {
    const { env } = tempHome();
    await run(["login", "--code-flow", "--no-browser"], { env, fetch: preflight().fetch });
    assert.ok(existsSync(pendingFile(env)));
    const later = new Date(Date.now() + 11 * 60 * 1000);
    const result = await run(["login", "--code", "AAAA"], { env, now: () => later });
    assert.equal(result.code, 2);
    assert.ok(!existsSync(pendingFile(env)));
  });

  it("is chosen without a terminal and without a display", async () => {
    const { chooseLoginMode } = await import(new URL("../dist/commands/login.js", import.meta.url).href);
    const io = (env, tty, platform = "linux") => ({ io: { env, platform, stdout: { isTTY: tty } } });
    assert.equal(chooseLoginMode({}, io({}, false)), "code");
    assert.equal(chooseLoginMode({}, io({ DISPLAY: ":0" }, false)), "background");
    assert.equal(chooseLoginMode({}, io({}, false, "darwin")), "background");
    assert.equal(chooseLoginMode({}, io({}, true, "darwin")), "foreground");
    assert.equal(chooseLoginMode({ "no-browser": true }, io({ SSH_CONNECTION: "1 2 3 4" }, true)), "code");
    assert.equal(chooseLoginMode({ background: true }, io({}, true)), "background");
  });
});

describe("trendsfast login --background", () => {
  it("returns before the browser does, and the detached listener stores the key", async () => {
    const { env } = tempHome();
    const server = await loginServer();
    try {
      const child = spawn(process.execPath, [cliPath, "login", "--background", "--no-browser", "--base-url", server.base], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const code = await new Promise((resolve) => child.on("close", resolve));
      // The foreground process has exited, with its streams closed, before any callback.
      assert.equal(code, 0, stderr);
      assert.match(stdout, /trendsfast whoami/);
      const authorize = stdout.match(/https?:\/\/\S+\/auth\/cli\/authorize\S+/)[0];
      const waiting = JSON.parse(readFileSync(statusFile(env), "utf8"));
      assert.equal(waiting.status, "waiting");
      assert.equal(waiting.mode, "background");
      assert.equal(mode(statusFile(env)), "600");

      const before = await run(["whoami"], { env });
      assert.equal(before.code, 2);
      assert.match(before.stdout, /waiting in the browser/);

      const callback = await approveInBrowser(authorize);
      assert.equal(callback.status, 200);
      const stored = await waitFor(() => existsSync(credentialsFile(env)) && JSON.parse(readFileSync(credentialsFile(env), "utf8")));
      assert.equal(stored.api_key, KEY);
      assert.equal(mode(credentialsFile(env)), "600");
      const done = await waitFor(() => {
        const status = JSON.parse(readFileSync(statusFile(env), "utf8"));
        return status.status === "signed_in" && status;
      });
      const raw = readFileSync(statusFile(env), "utf8");
      assert.ok(!raw.includes(KEY), "the status file never holds the key");
      assert.ok(!raw.includes(new URL(authorize).searchParams.get("state")), "nor the state");
      // The listener exits once it is done.
      await waitFor(() => {
        try {
          process.kill(waiting.pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(done.project_name, "Fixture Studio");
      const after = await run(["login", "--status"], { env });
      assert.equal(after.code, 0);
      assert.match(after.stdout, /Signed in to Fixture Studio/);
    } finally {
      await server.close();
    }
  });

  it("marks the sign-in expired when nobody finishes it in time", async () => {
    const { env } = tempHome();
    const server = await loginServer();
    try {
      const child = spawn(process.execPath, [cliPath, "login", "--background", "--no-browser", "--base-url", server.base], {
        env: { ...env, TRENDSFAST_LOGIN_TIMEOUT_MS: "300" },
        stdio: "ignore",
      });
      assert.equal(await new Promise((resolve) => child.on("close", resolve)), 0);
      const { pid } = JSON.parse(readFileSync(statusFile(env), "utf8"));
      const status = await waitFor(() => {
        const value = JSON.parse(readFileSync(statusFile(env), "utf8"));
        return value.status === "expired" && value;
      });
      assert.equal(status.mode, "background");
      assert.ok(!existsSync(credentialsFile(env)));
      // The listener exits on expiry too.
      await waitFor(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    } finally {
      await server.close();
    }
  });
});

describe("trendsfast login --paste and logout", () => {
  it("checks a pasted key with a free read, stores it 0600 and never echoes it", async () => {
    const { env } = tempHome();
    const { fetch, calls } = fakeFetch(() => json({ version: "credit-wallet-v3", available: 5 }));
    const result = await run(["login", "--paste"], { env, fetch, stdinText: `${KEY}\n` });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(calls[0].path, "/v3/trends/wallet");
    assert.ok(!result.stdout.includes(KEY) && !result.stderr.includes(KEY));
    assert.match(result.stdout, /tf_test_Fixture1/);
    assert.equal(mode(credentialsFile(env)), "600");
    const out = await run(["logout"], { env });
    assert.equal(out.code, 0);
    assert.ok(!existsSync(credentialsFile(env)));
  });

  it("refuses something that is not a key, and a key TrendsFast refuses", async () => {
    const { env } = tempHome();
    assert.equal((await run(["login", "--paste"], { env, stdinText: "hello\n" })).code, 1);
    const refused = await run(["login", "--paste"], { env, fetch: fakeFetch(() => json({ error: "AUTH_INVALID" }, 401)).fetch, stdinText: `${KEY}\n` });
    assert.equal(refused.code, 2);
    assert.ok(!existsSync(credentialsFile(env)));
  });
});
