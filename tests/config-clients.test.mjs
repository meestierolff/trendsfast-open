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
  await assert.rejects(
    writeCredential({
      paths,
      apiKey: "tf_test_replacement",
      consent: true,
    }),
    /changed after the write was planned/u,
  );
  assert.equal(
    await readCredential({ mode: "file", paths }),
    "tf_test_example0",
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
  assert.throws(
    () => parseStrictJson('{"id":9007199254740993}'),
    /losslessly/u,
  );
  assert.throws(() => parseStrictJson('{"id":1e400}'), /losslessly/u);
  assert.throws(
    () => parseStrictJson('{"id":0.10000000000000001}'),
    /losslessly/u,
  );
  assert.deepEqual(parseStrictJson('{"safe":1e3,"decimal":1.25}'), {
    safe: 1000,
    decimal: 1.25,
  });
});

test("client and skill writes reject symbolic ancestor components", async (t) => {
  const { home, paths } = await fixture(t);
  const redirected = join(home, "redirected-agent-root");
  await mkdir(redirected, { recursive: true });
  await symlink(redirected, join(home, ".agents"));
  await assert.rejects(
    installClientConfigurations({
      paths,
      clients: ["codex"],
      packageSource: "trendsfast-agent@0.1.0-alpha.0",
      credentialMode: "environment",
      endpoint: "https://example.test/mcp",
      protocolVersion: "2026-07-28",
      packageVersion: "0.1.0-alpha.0",
      skillBytes: Buffer.from("---\nname: trendsfast\n---\n"),
    }),
    /symbolic-link path component/u,
  );
  await assert.rejects(
    readFile(join(redirected, "skills", "trendsfast", "SKILL.md")),
    { code: "ENOENT" },
  );
  await assert.rejects(readFile(paths.codexConfig), { code: "ENOENT" });
  await assert.rejects(readFile(paths.stateFile), { code: "ENOENT" });
});

test("an identical unmanaged skill is never adopted or deleted", async (t) => {
  const { paths } = await fixture(t);
  const existingSkill = Buffer.from("---\nname: trendsfast\n---\n");
  await mkdir(join(paths.genericSkill, ".."), { recursive: true });
  await writeFile(paths.genericSkill, existingSkill);
  await assert.rejects(
    installClientConfigurations({
      paths,
      clients: ["generic"],
      packageSource: "trendsfast-agent@0.1.0-alpha.0",
      credentialMode: "environment",
      endpoint: "https://example.test/mcp",
      protocolVersion: "2026-07-28",
      packageVersion: "0.1.0-alpha.0",
      skillBytes: existingSkill,
    }),
    /unmanaged TrendsFast skill/u,
  );
  assert.deepEqual(await readFile(paths.genericSkill), existingSkill);
  await assert.rejects(readFile(paths.stateFile), { code: "ENOENT" });
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

test("an existing install cannot silently reselect or orphan clients", async (t) => {
  const { paths } = await fixture(t);
  const base = {
    paths,
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  };
  await installClientConfigurations({ ...base, clients: ["generic"] });
  await assert.rejects(
    installClientConfigurations({ ...base, clients: ["claude"] }),
    /uninstall first/u,
  );
  assert.match(await readFile(paths.genericConfig, "utf8"), /trendsfast/u);
  await assert.rejects(readFile(paths.claudeConfig), { code: "ENOENT" });
});

test("reinstall refuses drift so later uninstall cannot erase unrelated edits", async (t) => {
  const { paths } = await fixture(t);
  const input = {
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  };
  const state = await installClientConfigurations(input);
  const edited = JSON.parse(await readFile(paths.genericConfig, "utf8"));
  edited.unrelated = "preserve me";
  await writeFile(paths.genericConfig, `${JSON.stringify(edited)}\n`);
  await assert.rejects(
    installClientConfigurations(input),
    /uninstall first to preserve unrelated edits/u,
  );
  await uninstallClientConfigurations({ paths, state });
  assert.deepEqual(JSON.parse(await readFile(paths.genericConfig, "utf8")), {
    unrelated: "preserve me",
  });
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

test("uninstall rejects state paths outside the exact owned targets", async (t) => {
  const { home, paths } = await fixture(t);
  const state = await installClientConfigurations({
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  });
  const victim = join(home, "unrelated-victim.json");
  await writeFile(victim, "preserve exactly\n");
  const malicious = structuredClone(state);
  malicious.clients[0].configPath = victim;
  await assert.rejects(
    uninstallClientConfigurations({ paths, state: malicious }),
    /unowned client path/u,
  );
  assert.equal(await readFile(victim, "utf8"), "preserve exactly\n");
  assert.match(await readFile(paths.genericConfig, "utf8"), /trendsfast/u);
});

test("uninstall rejects a backup reference outside the confined backup directory", async (t) => {
  const { home, paths } = await fixture(t);
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.genericConfig, '{"preserve":true}\n');
  const state = await installClientConfigurations({
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  });
  const victim = join(home, `${"a".repeat(64)}.bak`);
  await writeFile(victim, "preserve victim\n");
  const malicious = structuredClone(state);
  malicious.clients[0].backupPath = victim;
  await assert.rejects(
    uninstallClientConfigurations({ paths, state: malicious }),
    /unconfined backup path/u,
  );
  assert.equal(await readFile(victim, "utf8"), "preserve victim\n");
});

test("uninstall refuses a corrupted backup before replacing client bytes", async (t) => {
  const { paths } = await fixture(t);
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.genericConfig, '{"preserve":true}\n');
  const state = await installClientConfigurations({
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  });
  const installed = await readFile(paths.genericConfig);
  await writeFile(state.clients[0].backupPath, "corrupted backup\n");
  await assert.rejects(
    uninstallClientConfigurations({ paths, state }),
    /backup changed/u,
  );
  assert.deepEqual(await readFile(paths.genericConfig), installed);
  assert.equal((await readFile(paths.stateFile)).length > 0, true);
});

test("install compare-and-swap preserves a concurrent client edit", async (t) => {
  const { paths } = await fixture(t);
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.genericConfig, '{"before":true}\n');
  const concurrent = '{"concurrent":true}\n';
  await assert.rejects(
    installClientConfigurations({
      paths,
      clients: ["generic"],
      packageSource: "trendsfast-agent@0.1.0-alpha.0",
      credentialMode: "environment",
      endpoint: "https://example.test/mcp",
      protocolVersion: "2026-07-28",
      packageVersion: "0.1.0-alpha.0",
      beforeCommit: () => writeFile(paths.genericConfig, concurrent),
    }),
    /changed after the write was planned/u,
  );
  assert.equal(await readFile(paths.genericConfig, "utf8"), concurrent);
  await assert.rejects(readFile(paths.stateFile), { code: "ENOENT" });
});

test("a losing concurrent installer cannot delete the winner's exact backup", async (t) => {
  const { paths } = await fixture(t);
  const original = Buffer.from('{"preserve":"winner backup"}\n');
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.genericConfig, original);
  const input = {
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  };
  let winner;
  await assert.rejects(
    installClientConfigurations({
      ...input,
      beforeCommit: async () => {
        winner = await installClientConfigurations(input);
      },
    }),
    /changed after the write was planned/u,
  );
  assert.ok(winner);
  assert.deepEqual(await readFile(winner.clients[0].backupPath), original);
  await uninstallClientConfigurations({ paths, state: winner });
  assert.deepEqual(await readFile(paths.genericConfig), original);
});

test("uninstall compare-and-swap preserves a concurrent client edit", async (t) => {
  const { paths } = await fixture(t);
  const state = await installClientConfigurations({
    paths,
    clients: ["generic"],
    packageSource: "trendsfast-agent@0.1.0-alpha.0",
    credentialMode: "environment",
    endpoint: "https://example.test/mcp",
    protocolVersion: "2026-07-28",
    packageVersion: "0.1.0-alpha.0",
  });
  const concurrent = JSON.stringify({
    mcpServers: {
      trendsfast: {
        command: "npx",
        args: ["-y", "trendsfast-agent@0.1.0-alpha.0", "mcp"],
        env: { TRENDSFAST_API_KEY: "${TRENDSFAST_API_KEY}" },
      },
    },
    concurrent: true,
  });
  await assert.rejects(
    uninstallClientConfigurations({
      paths,
      state,
      beforeCommit: () => writeFile(paths.genericConfig, concurrent),
    }),
    /changed after removal was planned/u,
  );
  assert.equal(await readFile(paths.genericConfig, "utf8"), concurrent);
  assert.equal((await readFile(paths.stateFile)).length > 0, true);
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
