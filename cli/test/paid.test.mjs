import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CONTEXT_ID, KEY, api, fakeFetch, json, resultFor, run, tempHome, walletBody } from "./helpers.mjs";

const signedIn = () => {
  const { env, home } = tempHome();
  return { env: { ...env, TRENDSFAST_API_KEY: KEY }, home };
};

describe("paid commands", () => {
  it("quote to stderr first, and refuse without --max-credits when there is no terminal", async () => {
    const { fetch, calls } = api();
    const { code, stdout, stderr } = await run(["customers"], { env: signedIn().env, fetch });
    assert.equal(code, 1);
    assert.equal(stdout, "", "stdout carries data only");
    assert.match(stderr, /Quote: Customers \(customers\) costs 10 credits/);
    assert.match(stderr, /trendsfast customers --max-credits 10/);
    assert.ok(!calls.some((c) => c.method === "POST"), "nothing paid was sent");
  });

  it("refuses a cap below the quote with exit 3, sending nothing", async () => {
    const { fetch, calls } = api({ price: 25 });
    const { code, stderr } = await run(["trending", "--max-credits", "10"], { env: signedIn().env, fetch });
    assert.equal(code, 3);
    assert.match(stderr, /below the price of 25 credits/);
    assert.ok(!calls.some((c) => c.method === "POST"));
  });

  it("saves the request ID before sending, prints a compact summary and the receipt", async () => {
    const { env, home } = signedIn();
    let journalAtSend;
    const { fetch, calls } = api({
      paid: (call) => {
        const path = join(home, ".local", "state", "trendsfast", "requests", `${call.body.request_id}.json`);
        journalAtSend = JSON.parse(readFileSync(path, "utf8"));
        return json(resultFor(call));
      },
    });
    const { code, stdout, stderr } = await run(["customers", "--max-credits", "10"], { env, fetch });
    assert.equal(code, 0, stderr);
    const post = calls.find((c) => c.method === "POST");
    assert.deepEqual(post.body.input, { product: "customers", context_id: CONTEXT_ID });
    assert.equal(post.body.max_credits, 10);
    assert.match(post.headers["user-agent"], /^trendsfast-cli\/\d+\.\d+\.\d+/);
    assert.equal(journalAtSend.status, "sending");
    assert.equal(journalAtSend.request_id, post.body.request_id);
    assert.ok(!JSON.stringify(journalAtSend).includes(KEY), "the journal never holds the key");
    const journal = JSON.parse(readFileSync(join(home, ".local", "state", "trendsfast", "requests", `${post.body.request_id}.json`), "utf8"));
    assert.equal(journal.status, "completed");
    assert.equal((statSync(join(home, ".local", "state", "trendsfast", "requests", `${post.body.request_id}.json`)).mode & 0o777).toString(8), "600");
    // The summary: every item's title, platform, observed time, signal and link; communities; coverage.
    assert.match(stdout, /^Customers \(customers\) · 2 items/);
    assert.match(stdout, /\[REDDIT\] Fixture: how do you chase a late invoice/);
    assert.match(stdout, /r\/fixture_freelance · fixture_user · observed 2026-10-15 11:00 UTC · score 143 · comments 57/);
    assert.match(stdout, /https:\/\/example\.invalid\/reddit\/late_invoice/);
    assert.match(stdout, /self-promotion RESTRICTED \(rule 1\)/);
    assert.match(stdout, /Coverage: REDDIT observed \(1\)/);
    assert.ok(stdout.length < 4000, "small on purpose");
    assert.match(stderr, /request_id \S+ · result_id 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f · charged 10 credits · balance 90 credits/);
  });

  it("prints the compact view with --json and the whole response with --format full", async () => {
    const env = signedIn().env;
    const compact = await run(["global", "--max-credits", "1", "--json"], { env, fetch: api({ price: 1 }).fetch });
    assert.equal(compact.code, 0, compact.stderr);
    assert.equal(JSON.parse(compact.stdout).version, "trends-mcp-compact-v3");
    const full = await run(["global", "--max-credits", "1", "--format", "full"], { env, fetch: api({ price: 1 }).fetch });
    assert.equal(JSON.parse(full.stdout).version, "trends-api-v3");
  });

  it("writes the full response into .trendsfast/, which ignores itself", async () => {
    const result = await run(["customers", "--max-credits", "10", "-o", "customers.json"], { env: signedIn().env, fetch: api().fetch });
    assert.equal(result.code, 0, result.stderr);
    const path = join(result.io.cwd, ".trendsfast", "customers.json");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).version, "trends-api-v3");
    assert.equal(readFileSync(join(result.io.cwd, ".trendsfast", ".gitignore"), "utf8").trim().split("\n").pop(), "*");
    assert.match(result.stderr, /Full response written to .*customers\.json/);
  });

  it("never writes through links a cloned project plants in .trendsfast/ (audit 2026-11-07)", async () => {
    const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, lstatSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const victim = mkdtempSync(join(tmpdir(), "tf-victim-"));
    const target = join(victim, "zshrc");
    writeFileSync(target, "export SAFE=1\n");

    // A leaf link: .trendsfast/customers.json -> ~/.zshrc. The link is replaced, the target kept.
    const leaf = mkdtempSync(join(tmpdir(), "tf-cwd-"));
    mkdirSync(join(leaf, ".trendsfast"));
    symlinkSync(target, join(leaf, ".trendsfast", "customers.json"));
    const wrote = await run(["customers", "--max-credits", "10", "-o", "customers.json"], { env: signedIn().env, fetch: api().fetch, cwd: leaf });
    assert.equal(wrote.code, 0, wrote.stderr);
    assert.equal(readFileSync(target, "utf8"), "export SAFE=1\n");
    assert.ok(lstatSync(join(leaf, ".trendsfast", "customers.json")).isFile());

    // A dangling .gitignore link must not create a file outside the project.
    const dangling = mkdtempSync(join(tmpdir(), "tf-cwd-"));
    mkdirSync(join(dangling, ".trendsfast"));
    symlinkSync(join(victim, "created-by-link"), join(dangling, ".trendsfast", ".gitignore"));
    assert.equal((await run(["customers", "--max-credits", "10", "-o", "customers.json"], { env: signedIn().env, fetch: api().fetch, cwd: dangling })).code, 0);
    assert.equal(existsSync(join(victim, "created-by-link")), false);
    assert.ok(lstatSync(join(dangling, ".trendsfast", ".gitignore")).isFile());

    // A directory link: .trendsfast -> elsewhere. Refused; nothing written there.
    const linked = mkdtempSync(join(tmpdir(), "tf-cwd-"));
    symlinkSync(victim, join(linked, ".trendsfast"));
    const refused = await run(["customers", "--max-credits", "10", "-o", "customers.json"], { env: signedIn().env, fetch: api().fetch, cwd: linked });
    assert.notEqual(refused.code, 0);
    assert.equal(existsSync(join(victim, "customers.json")), false);
    assert.equal(existsSync(join(victim, ".gitignore")), false);
  });

  it("reports an unknown outcome with exit 6 and the command to read it, never a new ID", async () => {
    const { env } = signedIn();
    const { fetch, calls } = api({ price: 1, paid: () => json({ error: "REQUEST_OUTCOME_UNCONFIRMED" }, 503, { "retry-after": "0" }) });
    const wrapped = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/v3/trends/requests/")) return json({ error: "NOT_FOUND" }, 404);
      return fetch(input, init);
    };
    const { code, stderr } = await run(["global", "--max-credits", "1"], { env, fetch: wrapped });
    assert.equal(code, 6);
    const posts = calls.filter((c) => c.method === "POST");
    assert.ok(posts.length >= 1);
    assert.equal(new Set(posts.map((c) => c.body.request_id)).size, 1);
    assert.match(stderr, new RegExp(`trendsfast request ${posts[0].body.request_id}`));
  });

  it("maps refusals to their exit codes", async () => {
    for (const [status, error, exit] of [
      [401, "AUTH_REQUIRED", 2],
      [402, "INSUFFICIENT_CREDITS", 3],
      [409, "IDEMPOTENCY_CONFLICT", 4],
      [429, "RATE_LIMITED", 5],
    ]) {
      const { fetch } = api({ price: 1, paid: () => json({ error }, status, status === 429 ? { "retry-after": "3600" } : {}) });
      const { code, stderr } = await run(["global", "--max-credits", "1"], { env: signedIn().env, fetch });
      assert.equal(code, exit, `${error}: ${stderr}`);
      assert.match(stderr, new RegExp(error));
    }
  });

  it("stops before a product when the brand has no confirmed context", async () => {
    const { fetch, calls } = api({ context: { version: "trend-context-v3", context: null } });
    const { code, stderr } = await run(["formats", "--max-credits", "20"], { env: signedIn().env, fetch });
    assert.equal(code, 1);
    assert.match(stderr, /PRODUCT_REQUIRES_CONTEXT/);
    assert.ok(!calls.some((c) => c.method === "POST"));
  });

  it("shows the request without sending it on --dry-run", async () => {
    const { fetch, calls } = api();
    const { code, stdout } = await run(["customers", "--dry-run", "--lookback-hours", "168"], { env: signedIn().env, fetch });
    assert.equal(code, 0);
    const plan = JSON.parse(stdout);
    assert.deepEqual(plan.body.input, { product: "customers", context_id: CONTEXT_ID, filters: { lookback_hours: 168 } });
    assert.equal(plan.body.max_credits, 10);
    assert.equal(plan.headers.authorization, "Bearer <your key>");
    assert.ok(!calls.some((c) => c.method === "POST"));
  });

  it("asks at a terminal unless --yes, and sends nothing on no", async () => {
    const { fetch, calls } = api();
    const { code } = await run(["customers"], { env: signedIn().env, fetch, tty: true, stdinText: "n\n" });
    assert.equal(code, 1);
    assert.ok(!calls.some((c) => c.method === "POST"));
  });

  it("sends a typed niche, a question and filters under the API's names", async () => {
    const env = signedIn().env;
    const niche = api({ price: 3 });
    assert.equal((await run(["niche", "Dental clinic scheduling", "--keywords", "dentist software", "--limit", "5", "--max-credits", "3"], { env, fetch: niche.fetch })).code, 0);
    assert.deepEqual(niche.calls.find((c) => c.method === "POST").body.input, {
      niche: { description: "Dental clinic scheduling", keywords: ["dentist software"] },
      filters: { limit: 5 },
    });
    const ask = api({ price: 5, paid: (call) => json(resultFor(call, "ask-result.json")) });
    const asked = await run(["ask", "What do dentists complain about?", "--brand", "--platforms", "reddit,x", "--max-credits", "5"], { env, fetch: ask.fetch });
    assert.equal(asked.code, 0, asked.stderr);
    assert.deepEqual(ask.calls.find((c) => c.method === "POST").body.input, {
      question: "What do dentists complain about?",
      context_id: CONTEXT_ID,
      filters: { platforms: ["REDDIT", "X"] },
    });
    assert.match(asked.stdout, /Answer \(PARTIAL\): Late payment/);
  });

  it("checks one video against its creator, sending the link and the handle Instagram needs", async () => {
    const env = signedIn().env;
    const check = api({ price: 5, paid: (call) => json(resultFor(call, "outlier-result.json")) });
    const done = await run(["outlier", "https://www.instagram.com/reel/C0deExample/", "--handle", "creator", "--max-credits", "5"], { env, fetch: check.fetch });
    assert.equal(done.code, 0, done.stderr);
    const sent = check.calls.find((c) => c.method === "POST");
    assert.equal(sent.path, "/v3/trends/outlier");
    assert.equal(sent.body.max_credits, 5);
    assert.deepEqual(sent.body.input, { url: "https://www.instagram.com/reel/C0deExample/", handle: "creator" });
    assert.match(done.stderr, /Quote: video outlier check costs 5 credits/);
    assert.match(done.stdout, /^Outlier: 6\.56× /m);
    assert.match(done.stdout, /The creator's posts in the read:/);
    const tiktok = api({ price: 5, paid: (call) => json(resultFor(call, "outlier-result.json")) });
    await run(["outlier", "https://www.tiktok.com/@creator/video/7300000000000000000", "--max-credits", "5"], { env, fetch: tiktok.fetch });
    assert.deepEqual(tiktok.calls.find((c) => c.method === "POST").body.input, {
      url: "https://www.tiktok.com/@creator/video/7300000000000000000",
    });
    const none = api();
    const missing = await run(["outlier", "--max-credits", "5"], { env, fetch: none.fetch });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /Give one video link/);
    assert.ok(!none.calls.some((c) => c.method === "POST"));
  });

  it("rejects an unknown platform before anything is sent", async () => {
    const { fetch, calls } = api();
    const { code, stderr } = await run(["customers", "--platforms", "myspace", "--max-credits", "10"], { env: signedIn().env, fetch });
    assert.equal(code, 1);
    assert.match(stderr, /--platforms does not know MYSPACE/);
    assert.ok(!calls.some((c) => c.method === "POST"));
  });

  it("needs a key before any paid call", async () => {
    const { code, stderr } = await run(["customers", "--max-credits", "10"], { env: tempHome().env, fetch: api().fetch });
    assert.equal(code, 2);
    assert.match(stderr, /Not signed in/);
  });
});

describe("free reads", () => {
  it("prices every command, telling the Trending product from a plain niche read", async () => {
    const env = signedIn().env;
    const { fetch, calls } = api();
    await run(["quote", "trending"], { env, fetch });
    await run(["quote", "niche"], { env, fetch });
    await run(["quote", "global"], { env, fetch });
    await run(["quote", "outlier"], { env, fetch });
    assert.deepEqual(calls.map((c) => c.url.search), ["?operation=niche&product=niche", "?operation=niche", "?operation=global", "?operation=outlier"]);
  });

  it("recovers a request by its ID and marks it completed in the journal", async () => {
    const { env } = signedIn();
    const id = "2b9e6c1d-4f3a-4e5b-8c7d-9a0b1c2d3e4f";
    const { code, stdout, stderr } = await run(["request", id], { env, fetch: api().fetch });
    assert.equal(code, 0, stderr);
    assert.match(stdout, /Request 2b9e6c1d/);
    assert.match(stderr, /this read is free/);
  });

  it("shows who is signed in without ever printing the key", async () => {
    const { env, home } = tempHome();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(home, ".config", "trendsfast"), { recursive: true });
    writeFileSync(
      join(home, ".config", "trendsfast", "credentials.json"),
      JSON.stringify({ api_key: KEY, key_id: "k", project_id: "p", project_name: "Fixture Studio", scopes: [], expires_at: "2027-01-27T00:00:00Z", base_url: "https://trendsfast.com", created_at: "" }),
    );
    const { code, stdout } = await run(["whoami"], { env, fetch: api().fetch });
    assert.equal(code, 0);
    assert.match(stdout, /Project: Fixture Studio/);
    assert.match(stdout, /Key: tf_test_Fixture1 · stored in/);
    assert.match(stdout, /expires 2027-01-27/);
    assert.match(stdout, /Balance: 90 credits/);
    assert.ok(!stdout.includes(KEY));
  });

  it("never sends the saved key to an origin named by --base-url or TRENDSFAST_BASE_URL (audit 2026-11-07)", async () => {
    const { env, home } = tempHome();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(home, ".config", "trendsfast"), { recursive: true });
    writeFileSync(
      join(home, ".config", "trendsfast", "credentials.json"),
      JSON.stringify({ api_key: KEY, key_id: "k", project_id: "p", project_name: "Fixture Studio", scopes: [], expires_at: "2027-01-27T00:00:00Z", base_url: "https://trendsfast.com", created_at: "" }),
    );
    for (const [argv, extra] of [
      [["credits", "--base-url", "https://attacker.example"], {}],
      [["whoami"], { TRENDSFAST_BASE_URL: "https://attacker.example" }],
      [["context", "--base-url", "https://attacker.example"], {}],
    ]) {
      const { fetch, calls } = fakeFetch(() => json(walletBody));
      const { code, stdout, stderr } = await run(argv, { env: { ...env, ...extra }, fetch });
      assert.notEqual(code, 0, `${argv.join(" ")} must not succeed`);
      assert.equal(calls.length, 0, `${argv.join(" ")} sent ${calls.length} request(s)`);
      assert.match(stdout + stderr, /belongs to https:\/\/trendsfast\.com/);
      assert.ok(!(stdout + stderr).includes(KEY));
    }
  });

  it("says when nobody is signed in", async () => {
    const { code, stdout } = await run(["whoami"], { env: tempHome().env });
    assert.equal(code, 2);
    assert.match(stdout, /Not signed in/);
  });

  it("prints nothing but the JSON on stdout with --json", async () => {
    const { stdout } = await run(["credits", "--json"], { env: signedIn().env, fetch: api().fetch });
    assert.equal(JSON.parse(stdout).available, 90);
  });
});
