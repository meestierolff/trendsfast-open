import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { formatCliError, runCli } from "../dist/cli.js";
import { REMOTE_MCP_TOOL_NAMES } from "../dist/constants.js";
import { resolveConfigPaths } from "../dist/config.js";

class Capture extends Writable {
  value = "";
  _write(chunk, _encoding, callback) {
    this.value += String(chunk);
    callback();
  }
}

async function homeFixture(t) {
  const homeDir = await mkdtemp(join(tmpdir(), "trendsfast-cli-test-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  return homeDir;
}

function success(data) {
  const structuredContent = { ok: true, data };
  return {
    resultType: "complete",
    isError: false,
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  };
}

function backend(handler) {
  return {
    tools: REMOTE_MCP_TOOL_NAMES.map((name) => ({
      name,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    })),
    callTool: handler,
  };
}

test("version prints only the four immutable public identities", async () => {
  const stdout = new Capture();
  await runCli(["version"], { stdout });
  assert.deepEqual(stdout.value.trim().split("\n"), [
    "package_version=0.1.0-alpha.0",
    "agent_skill_version=1.0.0",
    "mcp_contract_version=trendsfast-remote-mcp-v1",
    "mcp_protocol_version=2026-07-28",
  ]);
});

test("API key flags are refused without reflecting the supplied value", async () => {
  const supplied = "synthetic_secret_value_123456789";
  let caught;
  try {
    await runCli(["install", "--api-key", supplied]);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.match(formatCliError(caught), /^SECRET_IN_ARGV:/u);
  assert.equal(formatCliError(caught).includes(supplied), false);
});

test("dry-run defaults safely to generic and writes nothing", async (t) => {
  const homeDir = await homeFixture(t);
  const stdout = new Capture();
  await runCli(["install", "--dry-run"], { homeDir, env: {}, stdout });
  const output = JSON.parse(stdout.value);
  assert.equal(output.dry_run, true);
  assert.equal(output.package_source, "trendsfast-agent@0.1.0-alpha.0");
  assert.equal(output.dry_run_default_client, "generic");
  const paths = resolveConfigPaths({
    homeDir,
    platform: process.platform,
    env: {},
  });
  await assert.rejects(readFile(paths.stateFile), { code: "ENOENT" });
  await assert.rejects(readFile(paths.genericConfig), { code: "ENOENT" });
});

test("environment install ships the skill, contains no raw key, and uninstalls exactly", async (t) => {
  const homeDir = await homeFixture(t);
  const stdout = new Capture();
  const secret = "synthetic_project_key_1234567890";
  await runCli(["install", "--client", "generic"], {
    homeDir,
    env: { TRENDSFAST_API_KEY: secret },
    stdout,
  });
  const paths = resolveConfigPaths({
    homeDir,
    platform: process.platform,
    env: {},
  });
  const config = await readFile(paths.genericConfig, "utf8");
  assert.equal(config.includes(secret), false);
  assert.match(config, /trendsfast-agent@0\.1\.0-alpha\.0/u);
  assert.match(
    await readFile(paths.genericSkill, "utf8"),
    /^---\nname: trendsfast/mu,
  );
  assert.equal((await lstat(paths.configDir)).mode & 0o777, 0o700);
  const uninstallOutput = new Capture();
  await runCli(["uninstall"], { homeDir, env: {}, stdout: uninstallOutput });
  await assert.rejects(readFile(paths.genericConfig), { code: "ENOENT" });
  await assert.rejects(readFile(paths.genericSkill), { code: "ENOENT" });
  await assert.rejects(readFile(paths.stateFile), { code: "ENOENT" });
});

test("protected-file install requires consent and keeps the key out of client JSON and output", async (t) => {
  const homeDir = await homeFixture(t);
  const secret = "synthetic_project_key_abcdefghijk";
  await assert.rejects(
    runCli(["install", "--client", "generic", "--credential-mode", "file"], {
      homeDir,
      env: { TRENDSFAST_API_KEY: secret },
    }),
    /consent/u,
  );
  const stdout = new Capture();
  await runCli(
    ["install", "--client", "generic", "--credential-mode", "file", "--yes"],
    {
      homeDir,
      env: { TRENDSFAST_API_KEY: secret },
      stdout,
    },
  );
  const paths = resolveConfigPaths({
    homeDir,
    platform: process.platform,
    env: {},
  });
  assert.equal((await lstat(paths.credentialFile)).mode & 0o777, 0o600);
  assert.equal(
    (await readFile(paths.genericConfig, "utf8")).includes(secret),
    false,
  );
  assert.equal(stdout.value.includes(secret), false);
});

test("doctor uses only discovery-backed read tools and emits structured zero-effect diagnostics", async () => {
  const calls = [];
  const stdout = new Capture();
  const synthetic = backend(async (name) => {
    calls.push(name);
    return success(
      name === "trendsfast_sources_get" ? { sources: [] } : { value: name },
    );
  });
  await runCli(["doctor", "--json"], { backend: synthetic, stdout });
  assert.deepEqual(calls, [
    "trendsfast_project_context_get",
    "trendsfast_brief_latest_get",
    "trendsfast_sources_get",
  ]);
  const output = JSON.parse(stdout.value);
  assert.equal(output.status, "PASS");
  assert.equal(output.read_only, true);
  assert.equal(output.scans_created, 0);
  assert.equal(output.provider_calls, 0);
  assert.equal(output.model_calls, 0);
});

test("default demo reads context, latest, optional history/status and video handoff without creating", async () => {
  const calls = [];
  const stdout = new Capture();
  const synthetic = backend(async (name, args = {}) => {
    calls.push([name, args]);
    if (name === "trendsfast_project_context_get")
      return success({ project_id: "project_synthetic" });
    if (name === "trendsfast_brief_latest_get")
      return success({ brief_id: "brief_latest", format: "ARTICLE_OR_GUIDE" });
    if (name === "trendsfast_today_status_get")
      return success({ status: "REVIEW_REQUIRED", poll_after_seconds: null });
    if (name === "trendsfast_brief_get")
      return success({ brief_id: "brief_history", format: "VIDEO" });
    if (name === "trendsfast_creative_handoff_get")
      return success({ handoff_id: "handoff_synthetic" });
    throw new Error(`unexpected ${name}`);
  });
  await runCli(
    ["demo", "--scan-id", "scan_synthetic", "--brief-id", "brief_history"],
    {
      backend: synthetic,
      stdout,
    },
  );
  assert.equal(
    calls.some(([name]) => name === "trendsfast_today_create"),
    false,
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "trendsfast_project_context_get",
      "trendsfast_brief_latest_get",
      "trendsfast_today_status_get",
      "trendsfast_brief_get",
      "trendsfast_creative_handoff_get",
    ],
  );
  const output = JSON.parse(stdout.value);
  assert.equal(output.mode, "read_only");
  assert.equal(output.scans_created, 0);
  assert.equal(output.creative_handoff.handoff_id, "handoff_synthetic");
});

test("create refuses missing confirmation and performs no create", async () => {
  let calls = 0;
  const synthetic = backend(async () => {
    calls += 1;
    return success({});
  });
  await assert.rejects(
    runCli(
      [
        "demo",
        "--create",
        "--idempotency-key",
        "a6e0f7e1-02ab-47aa-9eab-8da232445b53",
        "--objective",
        "Choose one evidence-grounded Content Play",
        "--capability",
        "founder_text",
      ],
      { backend: synthetic, confirm: async () => false, stderr: new Capture() },
    ),
    /not confirmed/u,
  );
  assert.equal(calls, 0);
});

test("explicit create forwards one UUID exactly, honors poll timing, and stops for review", async () => {
  const idempotencyKey = "a6e0f7e1-02ab-47aa-9eab-8da232445b53";
  const calls = [];
  const sleeps = [];
  let statusCalls = 0;
  const stdout = new Capture();
  const synthetic = backend(async (name, args = {}) => {
    calls.push([name, args]);
    if (name === "trendsfast_today_create") {
      return success({
        scan_id: "scan_new",
        status: "QUEUED",
        status_url: "/api/mcp",
        poll_after_seconds: 30,
      });
    }
    if (name === "trendsfast_today_status_get") {
      statusCalls += 1;
      return statusCalls === 1
        ? success({ status: "RUNNING", poll_after_seconds: 30 })
        : success({ status: "REVIEW_REQUIRED", poll_after_seconds: null });
    }
    if (name === "trendsfast_brief_latest_get") {
      return success({
        brief_id: "brief_new",
        lifecycle_state: "REVIEW_REQUIRED",
        format: "VIDEO",
      });
    }
    if (name === "trendsfast_creative_handoff_get")
      return success({ handoff_id: "handoff_new" });
    throw new Error(`unexpected ${name}`);
  });
  await runCli(
    [
      "demo",
      "--create",
      "--yes",
      "--idempotency-key",
      idempotencyKey,
      "--objective",
      "Choose one evidence-grounded Content Play",
      "--capability",
      "founder_text",
    ],
    {
      backend: synthetic,
      stdout,
      stderr: new Capture(),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  );
  const creates = calls.filter(([name]) => name === "trendsfast_today_create");
  assert.equal(creates.length, 1);
  assert.equal(creates[0][1].idempotency_key, idempotencyKey);
  assert.deepEqual(sleeps, [30_000, 30_000]);
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "trendsfast_today_create",
      "trendsfast_today_status_get",
      "trendsfast_today_status_get",
      "trendsfast_brief_latest_get",
      "trendsfast_creative_handoff_get",
    ],
  );
  const output = JSON.parse(stdout.value);
  assert.equal(output.create_calls, 1);
  assert.equal(output.status.status, "REVIEW_REQUIRED");
  assert.equal(output.approved, false);
  assert.equal(output.delivered, false);
  assert.equal(output.published, false);
  assert.equal(output.scheduled, false);
});
