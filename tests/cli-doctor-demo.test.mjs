import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

function briefIdForScan(scanId) {
  return `brief_${Buffer.from(`today-trend-brief-v1\0${scanId}`, "utf8").toString("base64url")}`;
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
  assert.deepEqual(output.first_read_only_argv, [
    "npx",
    "-y",
    "trendsfast-agent@0.1.0-alpha.0",
    "doctor",
    "--json",
  ]);
  assert.equal(
    output.first_read_only_command,
    "npx -y trendsfast-agent@0.1.0-alpha.0 doctor --json",
  );
  const paths = resolveConfigPaths({
    homeDir,
    platform: process.platform,
    env: {},
  });
  await assert.rejects(readFile(paths.stateFile), { code: "ENOENT" });
  await assert.rejects(readFile(paths.genericConfig), { code: "ENOENT" });
});

test("GitHub dry-run advertises the exact immutable runnable npx source", async (t) => {
  const homeDir = await homeFixture(t);
  const shaSource = `github:meestierolff/trendsfast-open#${"a".repeat(40)}`;
  const stdout = new Capture();
  await runCli(["install", "--dry-run", "--package-source", shaSource], {
    homeDir,
    env: {},
    stdout,
  });
  const output = JSON.parse(stdout.value);
  assert.deepEqual(output.first_read_only_argv, [
    "npx",
    "-y",
    shaSource,
    "doctor",
    "--json",
  ]);
  assert.equal(
    output.first_read_only_command,
    `npx -y ${shaSource} doctor --json`,
  );
});

test("non-dry-run environment install validates the inherited key before writing", async (t) => {
  const homeDir = await homeFixture(t);
  await assert.rejects(
    runCli(["install", "--client", "generic"], {
      homeDir,
      env: {},
    }),
    /valid TrendsFast API key/u,
  );
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
  const unrelatedClaudeSkills = join(homeDir, ".claude", "skills");
  await mkdir(unrelatedClaudeSkills, { recursive: true });
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
  assert.equal((await lstat(unrelatedClaudeSkills)).isDirectory(), true);
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

test("failed install never deletes a concurrently replaced credential", async (t) => {
  const homeDir = await homeFixture(t);
  const paths = resolveConfigPaths({
    homeDir,
    platform: process.platform,
    env: {},
  });
  const original = "synthetic_project_key_original_12345";
  const replacement = "synthetic_project_key_replacement_67890";
  await assert.rejects(
    runCli(
      ["install", "--client", "generic", "--credential-mode", "file", "--yes"],
      {
        homeDir,
        env: { TRENDSFAST_API_KEY: original },
        afterCredentialWrite: async () => {
          await writeFile(paths.credentialFile, `${replacement}\n`);
          await writeFile(
            paths.genericConfig,
            `${JSON.stringify({
              mcpServers: {
                trendsfast: { command: "unmanaged", args: [] },
              },
            })}\n`,
          );
        },
      },
    ),
    /unmanaged TrendsFast entry/u,
  );
  assert.equal(
    await readFile(paths.credentialFile, "utf8"),
    `${replacement}\n`,
  );
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

test("doctor refuses a missing or modified local install before remote reads", async (t) => {
  const secret = "synthetic_project_key_doctor_12345";
  const synthetic = backend(async () => success({}));
  const missingHome = await homeFixture(t);
  const missingOutput = new Capture();
  await assert.rejects(
    runCli(["doctor", "--json"], {
      backend: synthetic,
      homeDir: missingHome,
      env: { TRENDSFAST_API_KEY: secret },
      stdout: missingOutput,
    }),
    /secure TrendsFast install/u,
  );
  assert.deepEqual(JSON.parse(missingOutput.value).error, {
    code: "INSTALL_REQUIRED",
    message:
      "Run the secure TrendsFast install command before using the live client.",
    retryable: false,
    retry_after_seconds: null,
  });

  const homeDir = await homeFixture(t);
  await runCli(["install", "--client", "generic"], {
    homeDir,
    env: { TRENDSFAST_API_KEY: secret },
    stdout: new Capture(),
  });
  const paths = resolveConfigPaths({
    homeDir,
    platform: process.platform,
    env: {},
  });
  await writeFile(paths.genericSkill, "modified skill\n");
  let calls = 0;
  const driftOutput = new Capture();
  await assert.rejects(
    runCli(["doctor", "--json"], {
      backend: backend(async () => {
        calls += 1;
        return success({});
      }),
      homeDir,
      env: { TRENDSFAST_API_KEY: secret },
      stdout: driftOutput,
    }),
    (error) => error?.code === "LOCAL_INSTALL_INVALID",
  );
  assert.equal(calls, 0);
  const drift = JSON.parse(driftOutput.value);
  assert.equal(drift.status, "FAIL");
  assert.equal(drift.error.code, "LOCAL_INSTALL_INVALID");
  assert.match(drift.error.message, /Uninstall and reinstall/u);
  assert.equal(drift.read_only, true);
  assert.equal(drift.scans_created, 0);
});

test("doctor permits unrelated local JSON edits when the managed entry remains exact", async (t) => {
  const homeDir = await homeFixture(t);
  const secret = "synthetic_project_key_doctor_unrelated";
  await runCli(["install", "--client", "generic"], {
    homeDir,
    env: { TRENDSFAST_API_KEY: secret },
    stdout: new Capture(),
  });
  const paths = resolveConfigPaths({
    homeDir,
    platform: process.platform,
    env: {},
  });
  const config = JSON.parse(await readFile(paths.genericConfig, "utf8"));
  config.unrelated = { preserved: true };
  await writeFile(paths.genericConfig, `${JSON.stringify(config)}\n`);
  const stdout = new Capture();
  await runCli(["doctor", "--json"], {
    backend: backend(async (name) =>
      success(name === "trendsfast_sources_get" ? { sources: [] } : {}),
    ),
    homeDir,
    env: { TRENDSFAST_API_KEY: secret },
    stdout,
  });
  assert.equal(JSON.parse(stdout.value).status, "PASS");
});

test("CLI never reflects untrusted tool error fields or inherited property names", async () => {
  const malicious = "private-provider-detail-must-not-escape";
  const synthetic = backend(async () => {
    const structuredContent = {
      ok: false,
      error: {
        version: "trendsfast-remote-mcp-v1",
        code: "constructor",
        message: malicious,
        retryable: false,
        retry_after_seconds: null,
      },
    };
    return {
      resultType: "complete",
      isError: true,
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    };
  });
  let caught;
  try {
    await runCli(["doctor", "--json"], {
      backend: synthetic,
      stdout: new Capture(),
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.match(formatCliError(caught), /^INTERNAL_FAILURE:/u);
  assert.equal(formatCliError(caught).includes(malicious), false);
});

test("doctor emits a structured safe FAIL envelope for revoked authentication", async () => {
  const malicious = "private-auth-provider-payload-must-not-escape";
  const synthetic = backend(async () => {
    const structuredContent = {
      ok: false,
      error: {
        version: "trendsfast-remote-mcp-v1",
        code: "AUTH_REVOKED",
        message: malicious,
        retryable: false,
        retry_after_seconds: null,
      },
    };
    return {
      resultType: "complete",
      isError: true,
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    };
  });
  const stdout = new Capture();
  await assert.rejects(
    runCli(["doctor", "--json"], { backend: synthetic, stdout }),
    (error) => error?.code === "AUTH_REVOKED",
  );
  const output = JSON.parse(stdout.value);
  assert.equal(output.status, "FAIL");
  assert.deepEqual(output.error, {
    code: "AUTH_REVOKED",
    message: "The project-scoped API key has been revoked.",
    retryable: false,
    retry_after_seconds: null,
  });
  assert.equal(stdout.value.includes(malicious), false);
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
      return success({
        brief_id: "brief_history",
        recommended_asset: { format: "VIDEO" },
      });
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

test("a video alternative does not trigger a handoff for a selected article", async () => {
  const calls = [];
  const stdout = new Capture();
  const synthetic = backend(async (name) => {
    calls.push(name);
    if (name === "trendsfast_project_context_get")
      return success({ project_id: "project_synthetic" });
    if (name === "trendsfast_brief_latest_get") {
      return success({
        brief_id: "brief_article",
        recommended_asset: { format: "ARTICLE_OR_GUIDE" },
        additional_content_angles: [{ format: "VIDEO" }],
      });
    }
    throw new Error(`unexpected ${name}`);
  });
  await runCli(["demo"], { backend: synthetic, stdout });
  assert.deepEqual(calls, [
    "trendsfast_project_context_get",
    "trendsfast_brief_latest_get",
  ]);
  assert.equal(JSON.parse(stdout.value).creative_handoff, null);
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
  const createdBriefId = briefIdForScan("scan_new");
  const synthetic = backend(async (name, args = {}) => {
    calls.push([name, args]);
    if (name === "trendsfast_project_context_get") {
      return success({
        project_id: "project_synthetic",
        context_version: "context_synthetic",
      });
    }
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
        brief_id: createdBriefId,
        project_id: "project_synthetic",
        project_context_version_id: "context_synthetic",
        lifecycle_state: "REVIEW_REQUIRED",
        objective: "Choose one evidence-grounded Content Play",
        agent_handoff: { content_capabilities: ["founder_text"] },
        recommended_asset: { format: "VIDEO" },
      });
    }
    if (name === "trendsfast_brief_get") {
      return success({
        brief_id: createdBriefId,
        project_id: "project_synthetic",
        project_context_version_id: "context_synthetic",
        lifecycle_state: "REVIEW_REQUIRED",
        objective: "Choose one evidence-grounded Content Play",
        agent_handoff: { content_capabilities: ["founder_text"] },
        recommended_asset: { format: "VIDEO" },
      });
    }
    if (name === "trendsfast_sources_get") return success({ sources: [] });
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
      "trendsfast_project_context_get",
      "trendsfast_today_create",
      "trendsfast_today_status_get",
      "trendsfast_today_status_get",
      "trendsfast_brief_latest_get",
      "trendsfast_brief_get",
      "trendsfast_sources_get",
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

test("create accepts an authoritative READY brief with omitted optional lifecycle", async () => {
  const scanId = "scan_ready";
  const briefId = briefIdForScan(scanId);
  const objective = "Choose one evidence-grounded Content Play";
  const completed = {
    brief_id: briefId,
    project_id: "project_synthetic",
    project_context_version_id: "context_synthetic",
    objective,
    agent_handoff: { content_capabilities: ["founder_text"] },
    recommended_asset: { format: "ARTICLE_OR_GUIDE" },
  };
  const calls = [];
  const synthetic = backend(async (name) => {
    calls.push(name);
    if (name === "trendsfast_project_context_get")
      return success({
        project_id: "project_synthetic",
        context_version: "context_synthetic",
      });
    if (name === "trendsfast_today_create")
      return success({
        scan_id: scanId,
        status: "QUEUED",
        status_url: "/api/mcp",
        poll_after_seconds: 30,
      });
    if (name === "trendsfast_today_status_get")
      return success({ status: "READY", poll_after_seconds: null });
    if (
      name === "trendsfast_brief_latest_get" ||
      name === "trendsfast_brief_get"
    )
      return success(completed);
    if (name === "trendsfast_sources_get") return success({ sources: [] });
    throw new Error(`unexpected ${name}`);
  });
  const stdout = new Capture();
  await runCli(
    [
      "demo",
      "--create",
      "--yes",
      "--idempotency-key",
      "17e94f65-d729-487e-8dc7-92dc4d50cddc",
      "--objective",
      objective,
      "--capability",
      "founder_text",
    ],
    {
      backend: synthetic,
      stdout,
      stderr: new Capture(),
      sleep: async () => undefined,
    },
  );
  assert.equal(JSON.parse(stdout.value).status.status, "READY");
  assert.deepEqual(calls, [
    "trendsfast_project_context_get",
    "trendsfast_today_create",
    "trendsfast_today_status_get",
    "trendsfast_brief_latest_get",
    "trendsfast_brief_get",
    "trendsfast_sources_get",
  ]);
});
