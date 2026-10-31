import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { KEY, api, fakeFetch, json, run, tempHome } from "./helpers.mjs";

describe("trendsfast doctor", () => {
  it("passes with a valid key, a brand and installed skills, using free reads only", async () => {
    const { env, home } = tempHome();
    mkdirSync(join(home, ".claude"), { recursive: true });
    await run(["init", "--all", "--no-login"], { env });
    const { fetch, calls } = api();
    const result = await run(["doctor"], { env: { ...env, TRENDSFAST_API_KEY: KEY }, fetch });
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, /ok\s+credentials\s+tf_test_Fixture1 from TRENDSFAST_API_KEY/);
    assert.match(result.stdout, /ok\s+api\s+.*90 credits available/);
    assert.match(result.stdout, /ok\s+skills\s+trendsfast in /);
    assert.match(result.stdout, /ok\s+agent claude-code\s+trendsfast linked in /);
    assert.ok(calls.every((c) => c.method === "GET"), "only free reads");
    assert.ok(!result.stdout.includes(KEY));
  });

  it("fails with the fix when there is no key", async () => {
    const result = await run(["doctor"], { env: tempHome().env, fetch: fakeFetch(() => json({ error: "invalid_request" }, 400)).fetch });
    assert.equal(result.code, 2);
    assert.match(result.stdout, /FAIL\s+credentials/);
    assert.match(result.stdout, /fix: Run trendsfast login --background/);
  });
});
