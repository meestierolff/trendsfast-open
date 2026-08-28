import assert from "node:assert/strict";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readCredential,
  resolveConfigPaths,
  serializeInstallState,
  writeCredential,
} from "../dist/config.js";
import {
  codexClientEntry,
  installClientConfigurations,
  parseStrictJson,
  uninstallClientConfigurations,
  updateCodexClient,
  updateJsonClient,
} from "../dist/clients.js";
import { atomicWriteFile } from "../dist/files.js";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "trendsfast-config-test-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    paths: resolveConfigPaths({ homeDir: home, platform: "linux", env: {} }),
  };
}

test("resolves secure platform locations", () => {
  assert.equal(
    resolveConfigPaths({ homeDir: "/h", platform: "linux", env: {} }).configDir,
    "/h/.config/trendsfast",
  );
  assert.equal(
    resolveConfigPaths({
      homeDir: "/h",
      platform: "darwin",
      env: { XDG_CONFIG_HOME: "/x" },
    }).configDir,
    "/x/trendsfast",
  );
  assert.match(
    resolveConfigPaths({
      homeDir: "C:\\h",
      platform: "win32",
      env: { APPDATA: "C:\\a" },
    }).configDir,
    /TrendsFast$/u,
  );
  assert.throws(
    () =>
      resolveConfigPaths({
        homeDir: "/h",
        platform: "linux",
        env: { XDG_CONFIG_HOME: "relative" },
      }),
    /absolute/u,
  );
  assert.throws(
    () => resolveConfigPaths({ homeDir: "/", platform: "linux", env: {} }),
    /non-root/u,
  );
});

test("credential file is consented, private, and readable without disclosure", async (t) => {
  const { paths } = await fixture(t);
  await assert.rejects(
    writeCredential({ paths, apiKey: "tf_test_example0", consent: false }),
  );
  await writeCredential({ paths, apiKey: "tf_test_example0", consent: true });
  assert.equal((await lstat(paths.configDir)).mode & 0o777, 0o700);
  assert.equal((await lstat(paths.credentialFile)).mode & 0o777, 0o600);
  assert.equal(
    await readCredential({ mode: "file", paths }),
    "tf_test_example0",
  );
  assert.equal(
    await readCredential({
      mode: "environment",
      paths,
      env: { TRENDSFAST_API_KEY: "tf_test_environment" },
    }),
    "tf_test_environment",
  );
  await chmod(paths.credentialFile, 0o644);
  await assert.rejects(readCredential({ mode: "file", paths }), /permissions/u);
});

test("rejects symlink targets", async (t) => {
  const { home } = await fixture(t);
  const target = join(home, "target");
  const linkPath = join(home, "link");
  await writeFile(target, "safe");
  await symlink(target, linkPath);
  await assert.rejects(
    atomicWriteFile(linkPath, Buffer.from("unsafe")),
    /symbolic-link/u,
  );
  assert.equal(await readFile(target, "utf8"), "safe");
  const hardlink = join(home, "hardlink");
  await link(target, hardlink);
  await assert.rejects(
    atomicWriteFile(hardlink, Buffer.from("unsafe")),
    /non-regular/u,
  );
});

test("strict JSON rejects duplicate and dangerous keys", () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /Duplicate/u);
  assert.throws(() => parseStrictJson('{"constructor":1}'), /Ambiguous/u);
});

test("client entries are exact and secret-free", () => {
  const source = "trendsfast-agent@0.1.0-alpha.0";
  const json = updateJsonClient(null, source, "environment");
  assert.deepEqual(JSON.parse(json).mcpServers.trendsfast, {
    command: "npx",
    args: ["-y", source, "mcp"],
    env: { TRENDSFAST_API_KEY: "${TRENDSFAST_API_KEY}" },
  });
  assert.ok(!json.includes("tf_test_secret"));
  assert.deepEqual(codexClientEntry(source, "environment"), {
    command: "npx",
    args: ["-y", source, "mcp"],
    env_vars: ["TRENDSFAST_API_KEY"],
    default_tools_approval_mode: "writes",
  });
  assert.ok(
    updateCodexClient(null, source, "file").includes(
      'default_tools_approval_mode = "writes"',
    ),
  );
});

test("Codex appends and removes only its exact managed block while preserving comments", async (t) => {
  const { paths } = await fixture(t);
  await mkdir(join(paths.homeDir, ".codex"), { recursive: true });
  const original = '# keep this comment\nmodel = "gpt-test"\n';
  await writeFile(paths.codexConfig, original);
  const state = await installClientConfigurations({
    paths,
    clients: ["codex"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  });
  const installed = await readFile(paths.codexConfig, "utf8");
  assert.ok(installed.startsWith(original));
  assert.match(installed, /trendsfast-agent managed entry/u);
  await uninstallClientConfigurations({ paths, state });
  assert.equal(await readFile(paths.codexConfig, "utf8"), original);
});

test("managed package source upgrades are explicit and retain the original backup", async (t) => {
  const { paths } = await fixture(t);
  const original = Buffer.from('{"unrelated":true}\n');
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.genericConfig, original);
  const base = {
    paths,
    clients: ["generic"],
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  };
  await installClientConfigurations({
    ...base,
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
  });
  const shaSource = `github:meestierolff/trendsfast-open#${"a".repeat(40)}`;
  const upgraded = await installClientConfigurations({
    ...base,
    packageSource: shaSource,
  });
  assert.match(
    await readFile(paths.genericConfig, "utf8"),
    new RegExp(shaSource),
  );
  await uninstallClientConfigurations({ paths, state: upgraded });
  assert.deepEqual(await readFile(paths.genericConfig), original);
});

test("install is idempotent, backs up bytes, preserves unrelated config, and restores exactly", async (t) => {
  const { paths } = await fixture(t);
  await mkdir(join(paths.homeDir, ".claude"), { recursive: true });
  const original = Buffer.from('{"theme":"dark"}\n');
  await writeFile(paths.claudeConfig, original);
  const input = {
    paths,
    clients: ["claude"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2025-06-18",
    packageVersion: "1.0.0",
    skillBytes: Buffer.from("---\nname: trendsfast\n---\n"),
  };
  const state = await installClientConfigurations(input);
  const once = await readFile(paths.claudeConfig);
  const stateAgain = await installClientConfigurations(input);
  assert.deepEqual(await readFile(paths.claudeConfig), once);
  assert.equal(
    stateAgain.clients[0].installedSha256,
    state.clients[0].installedSha256,
  );
  assert.deepEqual(await readFile(state.clients[0].backupPath), original);
  assert.equal(JSON.parse(once).theme, "dark");
  await uninstallClientConfigurations({ paths, state });
  assert.deepEqual(await readFile(paths.claudeConfig), original);
});

test("dry run does not create config or state", async (t) => {
  const { paths } = await fixture(t);
  await installClientConfigurations({
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "file",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2025-06-18",
    packageVersion: "1.0.0",
    dryRun: true,
  });
  await assert.rejects(readFile(paths.genericConfig), { code: "ENOENT" });
  await assert.rejects(readFile(paths.stateFile), { code: "ENOENT" });
});

test("modified unrelated JSON survives uninstall while TrendsFast entry is removed", async (t) => {
  const { paths } = await fixture(t);
  const state = await installClientConfigurations({
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "file",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2025-06-18",
    packageVersion: "1.0.0",
  });
  const changed = JSON.parse(await readFile(paths.genericConfig, "utf8"));
  changed.unrelated = true;
  await writeFile(paths.genericConfig, JSON.stringify(changed));
  await uninstallClientConfigurations({ paths, state });
  assert.deepEqual(JSON.parse(await readFile(paths.genericConfig, "utf8")), {
    unrelated: true,
  });
});

test("install state serialization rejects credential-like values", () => {
  assert.throws(
    () =>
      serializeInstallState({
        schemaVersion: 1,
        endpoint: "tf_live_secretvalue",
        protocolVersion: "v",
        packageVersion: "v",
        clients: [],
        skills: [],
      }),
    /credential/u,
  );
});
