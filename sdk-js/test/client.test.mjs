import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CONTEXT_ID, KEY, client, contextBody, fakeFetch, fixture, json, packageRoot, resultFor, sdk } from "./helpers.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("package", () => {
  it("reports the version package.json publishes", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    assert.equal(sdk.SDK_VERSION, pkg.version);
    assert.deepEqual(pkg.dependencies ?? {}, {}, "the SDK has no runtime dependencies");
  });
});

describe("credentials and base URL", () => {
  it("prefers the option, then TRENDSFAST_API_KEY, then the key trendsfast login stored", () => {
    const home = mkdtempSync(join(tmpdir(), "tf-sdk-"));
    const path = join(home, ".config", "trendsfast", "credentials.json");
    mkdirSync(join(home, ".config", "trendsfast"), { recursive: true });
    writeFileSync(path, JSON.stringify({ api_key: KEY, base_url: "http://127.0.0.1:4010", created_at: "" }));
    const env = { HOME: home };
    assert.equal(new sdk.TrendsFast({ env }).keySource, "stored");
    assert.equal(new sdk.TrendsFast({ env }).baseUrl, "http://127.0.0.1:4010", "a stored key keeps its origin");
    assert.equal(new sdk.TrendsFast({ env: { ...env, TRENDSFAST_API_KEY: KEY } }).keySource, "env");
    assert.equal(
      new sdk.TrendsFast({ env: { ...env, TRENDSFAST_API_KEY: KEY } }).baseUrl,
      "https://trendsfast.com",
      "an environment key does not borrow the stored key's origin",
    );
    assert.equal(new sdk.TrendsFast({ env, apiKey: KEY }).keySource, "option");
    assert.equal(new sdk.TrendsFast({ env: { HOME: join(home, "none") } }).keySource, "none");
  });

  it("accepts only https, or http on the loopback host", () => {
    for (const ok of ["https://trendsfast.com", "https://trendsfast.com/", "http://127.0.0.1:8080", "http://localhost:3000"])
      assert.ok(new sdk.TrendsFast({ apiKey: KEY, baseUrl: ok, env: {} }));
    for (const bad of ["http://trendsfast.com", "https://trendsfast.com/v3", "https://u:p@trendsfast.com", "ftp://x", "nope"])
      assert.throws(() => new sdk.TrendsFast({ apiKey: KEY, baseUrl: bad, env: {} }), sdk.InvalidRequestError, bad);
  });

  it("refuses to call without a key, before anything is sent", async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const tf = new sdk.TrendsFast({ fetch, env: { HOME: "/nonexistent" } });
    await assert.rejects(tf.wallet(), (error) => error instanceof sdk.AuthRequiredError && error.exitCode === 2);
    assert.equal(calls.length, 0);
  });
});

describe("product calls", () => {
  it("reads the brand's context for free, then runs the product once at its tariff", async () => {
    const { fetch, calls } = fakeFetch((call) => (call.path === "/v3/trends/context" ? json(contextBody) : json(resultFor(call))));
    const result = await client(fetch).customers();
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /v3/trends/context", "POST /v3/trends/niche"]);
    const post = calls[1];
    assert.match(post.body.request_id, UUID);
    assert.deepEqual(post.body, {
      request_id: post.body.request_id,
      max_credits: 10,
      input: { product: "customers", context_id: CONTEXT_ID },
    });
    assert.equal(post.headers.authorization, `Bearer ${KEY}`);
    assert.match(post.headers["user-agent"], /^trendsfast-js\/\d+\.\d+\.\d+/);
    assert.equal(post.redirect, "manual");
    assert.equal(result.request_id, post.body.request_id);
  });

  it("maps each product to its API id and price, and sends filters under input.filters", async () => {
    const prices = { trending: ["niche", 25], competitors: ["competitors", 30], formats: ["formats", 20], search: ["search", 35] };
    for (const [method, [id, credits]] of Object.entries(prices)) {
      const { fetch, calls } = fakeFetch((call) => json(resultFor(call)));
      await client(fetch)[method]({ context_id: CONTEXT_ID, lookback_hours: 168, platforms: ["TIKTOK"], limit: 5, request_id: "00000000-0000-4000-8000-000000000001" });
      assert.equal(calls.length, 1, "a given context_id needs no context read");
      assert.deepEqual(calls[0].body, {
        request_id: "00000000-0000-4000-8000-000000000001",
        max_credits: credits,
        input: { product: id, context_id: CONTEXT_ID, filters: { platforms: ["TIKTOK"], lookback_hours: 168, limit: 5 } },
      });
    }
  });

  it("stops before a product call when the brand has no confirmed context", async () => {
    const { fetch, calls } = fakeFetch(() => json({ version: "trend-context-v3", context: null }));
    await assert.rejects(client(fetch).formats(), (error) => error instanceof sdk.ProductRequiresContextError && error.exitCode === 1);
    assert.deepEqual(calls.map((c) => c.path), ["/v3/trends/context"]);
  });
});

describe("index reads", () => {
  it("sends a typed niche, a question and a discover scope as the API names them", async () => {
    const { fetch, calls } = fakeFetch((call) => json(resultFor(call, call.path.endsWith("/ask") ? "ask-result.json" : "global-result.json")));
    const tf = client(fetch);
    await tf.globalTrends({ lookback_hours: 24, limit: 5 });
    await tf.niche("Scheduling software for dental clinics", { limit: 10 });
    await tf.ask("What are dentists stuck on?", { context_id: CONTEXT_ID });
    await tf.discover("What is rising?", { scope: ["global"], channels: ["video"] });
    assert.deepEqual(calls.map((c) => [c.path, c.body.max_credits, c.body.input]), [
      ["/v3/trends/global", 1, { lookback_hours: 24, limit: 5 }],
      ["/v3/trends/niche", 3, { niche: { description: "Scheduling software for dental clinics" }, filters: { limit: 10 } }],
      ["/v3/trends/ask", 5, { question: "What are dentists stuck on?", context_id: CONTEXT_ID }],
      ["/v3/trends/discover", 5, { question: "What is rising?", scope: ["global"], channels: ["video"] }],
    ]);
  });

  it("reads the brand context for a niche read without a description", async () => {
    const { fetch, calls } = fakeFetch((call) => (call.path === "/v3/trends/context" ? json(contextBody) : json(resultFor(call))));
    await client(fetch).niche();
    assert.deepEqual(calls[1].body.input, { context_id: CONTEXT_ID });
    assert.equal(calls[1].body.max_credits, 3);
  });
});

describe("free reads", () => {
  it("quotes a product with operation niche, and reads, pages and recovers by ID", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.path === "/v3/trends/quote")
        return json({ version: "trends-credit-quote-v3", operation: call.url.searchParams.get("operation"), credits: 10, max_credits: 10, catalog_version: "x", new_research: false, available: true });
      if (call.path.startsWith("/v3/trends/results/")) {
        const result = fixture("global-result.json");
        result.result_id = call.path.split("/").pop();
        return json(result);
      }
      if (call.path.startsWith("/v3/trends/requests/")) return json(resultFor(call, "global-result.json"));
      return json({ version: "trends-history-v3", results: [], next_cursor: null });
    });
    const tf = client(fetch);
    assert.equal((await tf.quote("niche", "customers")).credits, 10);
    await assert.rejects(tf.quote("global", "customers"), sdk.InvalidRequestError);
    const id = "33333333-3333-4333-8333-333333333333";
    await tf.result(id, "next-page");
    await tf.recover("22222222-2222-4222-8222-222222222222");
    await tf.history("cursor-1");
    assert.deepEqual(calls.map((c) => `${c.path}${c.url.search}`), [
      "/v3/trends/quote?operation=niche&product=customers",
      `/v3/trends/results/${id}?cursor=next-page`,
      "/v3/trends/requests/22222222-2222-4222-8222-222222222222",
      "/v3/trends/history?cursor=cursor-1",
    ]);
  });

  it("says a request with no record never started", async () => {
    const { fetch } = fakeFetch(() => json({ error: "NOT_FOUND", retryable: false }, 404));
    await assert.rejects(client(fetch).recover("22222222-2222-4222-8222-222222222222"), (error) => {
      assert.ok(error instanceof sdk.InvalidRequestError);
      assert.match(error.message, /no record/);
      return true;
    });
  });

  it("treats a free read that gets no answer as a service failure, not an unknown outcome", async () => {
    const { fetch, calls } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(client(fetch, { maxRetries: 1 }).wallet(), (error) => error instanceof sdk.ServiceUnavailableError && error.exitCode === 7);
    assert.equal(calls.length, 2, "one retry");
  });
});

describe("errors", () => {
  const cases = [
    [401, "AUTH_REQUIRED", "AuthRequiredError", 2],
    [401, "AUTH_EXPIRED", "AuthRequiredError", 2],
    [403, "FORBIDDEN", "InsufficientScopeError", 2],
    [403, "INSUFFICIENT_SCOPE", "InsufficientScopeError", 2],
    [402, "INSUFFICIENT_CREDITS", "InsufficientCreditsError", 3],
    [402, "CREDIT_QUOTE_EXCEEDS_LIMIT", "CreditQuoteExceedsLimitError", 3],
    [409, "IDEMPOTENCY_CONFLICT", "IdempotencyConflictError", 4],
    [409, "CONTEXT_NOT_CURRENT", "ContextNotCurrentError", 4],
    [409, "ACCOUNT_PAUSED", "ConflictError", 4],
    [400, "PRODUCT_REQUIRES_CONTEXT", "ProductRequiresContextError", 1],
    [400, "INVALID_INPUT", "InvalidRequestError", 1],
    [410, "RESULT_UNAVAILABLE", "ResultUnavailableError", 4],
    [409, "REQUEST_IN_PROGRESS", "OutcomeUnconfirmedError", 6],
  ];
  for (const [status, code, name, exit] of cases)
    it(`maps ${status} ${code} to ${name} and exit code ${exit}, without retrying`, async () => {
      const { fetch, calls } = fakeFetch(() => json({ error: code, retryable: false }, status));
      await assert.rejects(client(fetch).globalTrends(), (error) => {
        assert.equal(error.constructor.name, name);
        assert.ok(error instanceof sdk.TrendsFastError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        assert.equal(error.exitCode, exit);
        assert.match(error.requestId, UUID);
        assert.ok(!JSON.stringify({ ...error, message: error.message }).includes(KEY), "never carries the key");
        return true;
      });
      assert.equal(calls.length, 1, "a 4xx is never retried");
    });

  it("retries a 429 with the same request ID, honouring Retry-After, then reports it", async () => {
    const waits = [];
    const { fetch, calls } = fakeFetch(() => json({ error: "RATE_LIMITED", retryable: false }, 429, { "retry-after": "2" }));
    const tf = client(fetch, { sleep: async (ms) => void waits.push(ms) });
    await assert.rejects(tf.globalTrends(), (error) => error instanceof sdk.RateLimitedError && error.retryAfterSeconds === 2 && error.exitCode === 5);
    assert.equal(calls.length, 4, "the first attempt and three retries");
    assert.deepEqual(waits, [2000, 2000, 2000]);
    assert.equal(new Set(calls.map((c) => c.body.request_id)).size, 1, "every attempt carries the same request ID");
  });

  it("does not wait out a Retry-After longer than its limit", async () => {
    const { fetch, calls } = fakeFetch(() => json({ error: "RATE_LIMITED" }, 429, { "retry-after": "3600" }));
    await assert.rejects(client(fetch).globalTrends(), sdk.RateLimitedError);
    assert.equal(calls.length, 1);
  });
});

describe("lost answers on a paid call", () => {
  it("retries with the same request ID, then reads the request back once for free", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === "POST") throw new TypeError("socket hang up");
      return json(resultFor(call, "global-result.json"));
    });
    const result = await client(fetch).globalTrends();
    const posts = calls.filter((c) => c.method === "POST");
    const reads = calls.filter((c) => c.method === "GET");
    assert.equal(posts.length, 4);
    assert.equal(new Set(posts.map((c) => c.body.request_id)).size, 1, "never a new request ID");
    assert.equal(reads.length, 1, "exactly one recovery read");
    assert.equal(reads[0].path, `/v3/trends/requests/${posts[0].body.request_id}`);
    assert.equal(result.request_id, posts[0].body.request_id);
  });

  it("reports the outcome as unconfirmed, with the request ID, when the read finds nothing", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === "POST") return json({ error: "REQUEST_OUTCOME_UNCONFIRMED", retryable: false }, 503);
      return json({ error: "NOT_FOUND" }, 404);
    });
    await assert.rejects(client(fetch, { maxRetries: 0 }).customers({ context_id: CONTEXT_ID }), (error) => {
      assert.ok(error instanceof sdk.OutcomeUnconfirmedError);
      assert.equal(error.exitCode, 6);
      assert.equal(error.requestId, calls[0].body.request_id);
      assert.match(error.message, new RegExp(`trendsfast request ${error.requestId}`));
      return true;
    });
    assert.deepEqual(calls.map((c) => c.method), ["POST", "GET"]);
  });

  it("recovers a 503 by sending the same request ID again", async () => {
    const { fetch, calls } = fakeFetch((call, index) =>
      index === 0 ? json({ error: "REQUEST_OUTCOME_UNCONFIRMED" }, 503) : json(resultFor(call, "global-result.json")),
    );
    const result = await client(fetch).globalTrends();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.request_id, calls[0].body.request_id);
    assert.equal(result.request_id, calls[0].body.request_id);
  });

  it("does not accept an answer for another request", async () => {
    const { fetch, calls } = fakeFetch((call, index) => {
      const result = resultFor(call, "global-result.json");
      if (index === 0) result.request_id = "99999999-9999-4999-8999-999999999999";
      return json(result);
    });
    const result = await client(fetch).globalTrends();
    assert.equal(calls.length, 2);
    assert.equal(result.request_id, calls[0].body.request_id);
  });

  it("does not follow a redirect with the key", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }));
    await assert.rejects(client(fetch).wallet(), (error) => error.code === "REDIRECT_NOT_FOLLOWED");
    assert.equal(calls.length, 1);
  });
});
