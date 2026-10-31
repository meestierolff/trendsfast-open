import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixture, sdk } from "./helpers.mjs";

// The private product repository checks compactResult against the MCP server's own compact
// view for these same fixtures; these tests pin what an agent reads from it.
describe("compactResult", () => {
  it("keeps what an agent acts on for each item and the ids to come back by", () => {
    const full = fixture("customers-result.json");
    const compact = sdk.compactResult(full);
    assert.equal(compact.version, "trends-mcp-compact-v3");
    assert.equal(compact.result_id, full.result_id);
    assert.equal(compact.request_id, full.request_id);
    assert.deepEqual(compact.usage, { credits_charged: 10, this_request_credits: 10, replayed: false });
    const [thread, tweet] = compact.items;
    assert.equal(thread.platform, "REDDIT");
    assert.equal(thread.community, "r/fixture_freelance");
    assert.deepEqual(thread.metrics, { score: 143, comments: 57 });
    assert.deepEqual(tweet.metrics, { likes: 88, reposts: 12 }, "a metric the platform did not show is left out");
    assert.equal(thread.problem, "Clients pay invoices 60 days late");
    for (const absent of ["current_observation", "observation_ids", "growth", "limitations"]) assert.ok(!(absent in thread));
    assert.equal(compact.communities[0].community, "fixture_freelance");
    assert.deepEqual(compact.communities[0].formats.map((f) => f.format), ["QUESTION", "STORY", "GUIDE"]);
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full)) / 2);
  });

  it("answers an Ask with its findings and only the items they cite", () => {
    const compact = sdk.compactResult(fixture("ask-result.json"));
    assert.equal(compact.answer.answer_status, "PARTIAL");
    assert.deepEqual(compact.items.map((item) => item.id), ["item_late_invoice"]);
    assert.ok(!("evidence_ids" in compact.answer.findings[0]));
  });

  it("carries a Search call's AI answers and a Trending item's topic history", () => {
    const search = sdk.compactResult(fixture("search-result.json"));
    assert.equal(search.ai_answers.answers[0].mentions_you, false);
    assert.deepEqual(search.ai_answers.answers[0].competitors_named, ["Example Invoicing"]);
    const trending = sdk.compactResult(fixture("trending-result.json"));
    assert.deepEqual(trending.items[0].topic_history, { state: "RISING", since: "2026-10-10", peak_day: "2026-10-14", channels: 3, velocity: 0.4 });
    assert.equal(trending.items[0].hook, "Stop sending invoices like this.");
  });

  it("bounds free text and marks what it cut", () => {
    assert.equal(sdk.clip("a".repeat(10), 5), "aaaa…");
    assert.equal(sdk.clip("  short  ", 5), "short");
    assert.equal(sdk.clip(null, 5), null);
  });
});
