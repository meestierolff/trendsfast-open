import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lintScript = resolve(repositoryRoot, "scripts/lint.mjs");
const auditScript = resolve(repositoryRoot, "scripts/package-audit.mjs");
const secretScanScript = resolve(repositoryRoot, "scripts/secret-scan.mjs");

function cleanEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      /(?:^|_)(?:API_KEY|AUTH|DATABASE_URL|PASSWORD|SECRET|TOKEN)(?:_|$)/i.test(
        name,
      )
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    NO_COLOR: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_loglevel: "silent",
    npm_config_update_notifier: "false",
  };
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: cleanEnvironment(),
    maxBuffer: 5_000_000,
  });
}

function runPolicy(script, root) {
  return run(process.execPath, [script, "--root", root], repositoryRoot);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "trendsfast-policy-test-"));
}

function syntheticIntegrity() {
  return `sha512-${"A".repeat(86)}`;
}

function reviewedScripts() {
  return {
    boundary: "node scripts/check-boundary.mjs",
    build: "tsc -p tsconfig.json",
    check:
      "npm run boundary && npm run format:check && npm run lint && npm run typecheck && npm test && npm run secret:scan && npm run package:audit",
    format: "prettier --write .",
    "format:check": "prettier --check .",
    lint: "node scripts/lint.mjs",
    "package:audit": "node scripts/package-audit.mjs",
    "secret:scan": "node scripts/secret-scan.mjs",
    test: "npm run build && node --test tests/*.test.mjs",
    typecheck: "tsc -p tsconfig.json --noEmit",
  };
}

function makePackageFixture(root) {
  const packageJson = {
    name: "trendsfast-agent",
    version: "0.1.0-alpha.0",
    description: "Synthetic security-policy fixture",
    type: "module",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/meestierolff/trendsfast-open.git",
    },
    homepage: "https://trendsfast.com/mcp",
    bugs: "https://github.com/meestierolff/trendsfast-open/issues",
    engines: { node: ">=22" },
    bin: { trendsfast: "bin/trendsfast.js" },
    files: [
      "bin/",
      "dist/",
      "skills/trendsfast/SKILL.md",
      "LICENSE",
      "README.md",
    ],
    scripts: reviewedScripts(),
    dependencies: {
      "@modelcontextprotocol/server": "2.0.0",
      "smol-toml": "1.8.0",
    },
    devDependencies: {},
    publishConfig: { access: "public", tag: "next" },
  };
  const packageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: packageJson.name,
        version: packageJson.version,
        license: "MIT",
        dependencies: packageJson.dependencies,
        bin: packageJson.bin,
        engines: packageJson.engines,
      },
      "node_modules/@modelcontextprotocol/server": {
        version: "2.0.0",
        resolved:
          "https://registry.npmjs.org/@modelcontextprotocol/server/-/server-2.0.0.tgz",
        integrity: syntheticIntegrity(),
        license: "MIT",
      },
      "node_modules/smol-toml": {
        version: "1.8.0",
        resolved: "https://registry.npmjs.org/smol-toml/-/smol-toml-1.8.0.tgz",
        integrity: syntheticIntegrity(),
        license: "BSD-3-Clause",
      },
    },
  };

  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "skills", "trendsfast"), { recursive: true });
  writeJson(join(root, "package.json"), packageJson);
  writeJson(join(root, "package-lock.json"), packageLock);
  writeFileSync(join(root, "README.md"), "# Synthetic fixture\n");
  writeFileSync(
    join(root, "LICENSE"),
    "MIT License\n\nSynthetic fixture only.\n",
  );
  writeFileSync(join(root, "bin", "trendsfast.js"), "#!/usr/bin/env node\n");
  chmodSync(join(root, "bin", "trendsfast.js"), 0o755);
  writeFileSync(
    join(root, "dist", "cli.js"),
    "export const synthetic = true;\n",
  );
  writeFileSync(
    join(root, "skills", "trendsfast", "SKILL.md"),
    "# Synthetic skill\n",
  );
  return { packageJson, packageLock };
}

function git(root, args) {
  const result = run("git", args, root);
  assert.equal(result.status, 0, result.stderr);
}

function initializeGitFixture(root) {
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Synthetic Test"]);
  git(root, ["config", "user.email", "synthetic@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "synthetic baseline"]);
}

function syntheticSecret() {
  return ["npm", "_", "A".repeat(40)].join("");
}

test("lint accepts a synthetic public-only runtime", () => {
  const root = makeTemporaryDirectory();
  try {
    mkdirSync(join(root, "src"));
    writeJson(join(root, "package.json"), {
      scripts: {},
      dependencies: {},
    });
    writeFileSync(
      join(root, "src", "index.js"),
      'export const endpoint = "https://trendsfast.com/api/mcp";\n',
    );
    const result = runPolicy(lintScript, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PUBLIC_AGENT_LINT_VALID/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("lint rejects telemetry, privileged configuration and lifecycle hooks", () => {
  const root = makeTemporaryDirectory();
  try {
    mkdirSync(join(root, "src"));
    writeJson(join(root, "package.json"), {
      scripts: { postinstall: "node setup.js" },
      dependencies: { "posthog-node": "1.0.0" },
    });
    writeFileSync(
      join(root, "src", "index.js"),
      'import "posthog-node";\nexport const value = process.env.DATABASE_URL;\n',
    );
    const result = runPolicy(lintScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /telemetry dependency is forbidden/);
    assert.match(result.stderr, /privileged-environment-reference/);
    assert.match(
      result.stderr,
      /npm lifecycle script is forbidden: postinstall/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("lint confines network and environment access to the reviewed runtime surface", () => {
  const root = makeTemporaryDirectory();
  try {
    mkdirSync(join(root, "src"));
    writeJson(join(root, "package.json"), { scripts: {}, dependencies: {} });
    writeFileSync(
      join(root, "src", "installer.js"),
      'export const setting = process.env.UNRELATED_CONFIG;\nexport const request = fetch("https://trendsfast.com/api/mcp");\n',
    );
    const result = runPolicy(lintScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unreviewed environment access is forbidden/);
    assert.match(
      result.stderr,
      /network access outside the reviewed MCP transport is forbidden/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("secret scan accepts a synthetic clean repository and package", () => {
  const root = makeTemporaryDirectory();
  try {
    makePackageFixture(root);
    initializeGitFixture(root);
    const result = runPolicy(secretScanScript, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SECRET_SCAN_VALID/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("secret scan packs with lifecycle scripts disabled", () => {
  const root = makeTemporaryDirectory();
  try {
    const { packageJson } = makePackageFixture(root);
    packageJson.scripts.prepack =
      "node -e \"require('node:fs').writeFileSync('lifecycle-ran','x')\"";
    writeJson(join(root, "package.json"), packageJson);
    initializeGitFixture(root);
    const result = runPolicy(secretScanScript, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(root, "lifecycle-ran")), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("secret scan detects a tracked working-tree secret without echoing it", () => {
  const root = makeTemporaryDirectory();
  const credential = syntheticSecret();
  try {
    makePackageFixture(root);
    initializeGitFixture(root);
    writeFileSync(
      join(root, "dist", "cli.js"),
      `export const credential = "${credential}";\n`,
    );
    const result = runPolicy(secretScanScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tracked:dist\/cli\.js/);
    assert.equal(result.stderr.includes(credential), false);
    assert.equal(result.stdout.includes(credential), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("secret scan detects a staged secret even when the working tree is clean", () => {
  const root = makeTemporaryDirectory();
  const credential = syntheticSecret();
  try {
    makePackageFixture(root);
    initializeGitFixture(root);
    writeFileSync(
      join(root, "dist", "cli.js"),
      `export const credential = "${credential}";\n`,
    );
    git(root, ["add", "dist/cli.js"]);
    writeFileSync(
      join(root, "dist", "cli.js"),
      "export const synthetic = true;\n",
    );
    const result = runPolicy(secretScanScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /index:dist\/cli\.js/);
    assert.equal(result.stderr.includes(credential), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("secret scan detects a deleted secret anywhere in reachable Git history", () => {
  const root = makeTemporaryDirectory();
  const credential = syntheticSecret();
  try {
    makePackageFixture(root);
    initializeGitFixture(root);
    writeFileSync(join(root, "historical.txt"), `${credential}\n`);
    git(root, ["add", "historical.txt"]);
    git(root, ["commit", "--quiet", "-m", "synthetic historical fixture"]);
    rmSync(join(root, "historical.txt"));
    git(root, ["add", "historical.txt"]);
    git(root, [
      "commit",
      "--quiet",
      "-m",
      "remove synthetic historical fixture",
    ]);
    const result = runPolicy(secretScanScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /history:[0-9a-f]{12}/);
    assert.equal(result.stderr.includes(credential), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("secret scan inspects an untracked file included only by npm pack", () => {
  const root = makeTemporaryDirectory();
  const credential = syntheticSecret();
  try {
    makePackageFixture(root);
    initializeGitFixture(root);
    writeFileSync(
      join(root, "dist", "untracked.js"),
      `export const credential = "${credential}";\n`,
    );
    const result = runPolicy(secretScanScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tarball:package\/dist\/untracked\.js/);
    assert.equal(result.stderr.includes(credential), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("package audit accepts the exact synthetic package policy", () => {
  const root = makeTemporaryDirectory();
  try {
    makePackageFixture(root);
    const result = runPolicy(auditScript, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PACKAGE_AUDIT_VALID/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("package audit rejects lifecycle hooks and dependency drift", () => {
  const root = makeTemporaryDirectory();
  try {
    const { packageJson } = makePackageFixture(root);
    packageJson.scripts.postinstall = "node setup.js";
    packageJson.dependencies.unreviewed = "1.0.0";
    writeJson(join(root, "package.json"), packageJson);
    const result = runPolicy(auditScript, root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /npm lifecycle script is forbidden: postinstall/,
    );
    assert.match(
      result.stderr,
      /runtime dependencies must match the exact reviewed allowlist/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("package audit rejects lockfile package, version, license and install-hook drift", () => {
  const root = makeTemporaryDirectory();
  try {
    const { packageLock } = makePackageFixture(root);
    packageLock.packages["node_modules/smol-toml"].version = "1.8.1";
    packageLock.packages["node_modules/smol-toml"].license = "UNREVIEWED";
    packageLock.packages["node_modules/smol-toml"].hasInstallScript = true;
    packageLock.packages["node_modules/unreviewed"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/unreviewed/-/unreviewed-1.0.0.tgz",
      integrity: syntheticIntegrity(),
      license: "MIT",
    };
    writeJson(join(root, "package-lock.json"), packageLock);
    const result = runPolicy(auditScript, root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /lockfile package version is outside the allowlist: smol-toml/,
    );
    assert.match(
      result.stderr,
      /dependency license is outside the allowlist: smol-toml/,
    );
    assert.match(
      result.stderr,
      /dependency install hook is forbidden: smol-toml/,
    );
    assert.match(
      result.stderr,
      /lockfile package is outside the allowlist: unreviewed/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("package audit rejects files outside the packed payload allowlist", () => {
  const root = makeTemporaryDirectory();
  try {
    makePackageFixture(root);
    writeFileSync(
      join(root, "dist", "private.txt"),
      "synthetic boundary violation\n",
    );
    const result = runPolicy(auditScript, root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /packed path is outside the allowlist: dist\/private\.txt/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("package audit enforces the own-package file-count budget", () => {
  const root = makeTemporaryDirectory();
  try {
    makePackageFixture(root);
    for (let index = 0; index < 101; index += 1) {
      writeFileSync(
        join(root, "dist", `synthetic-${index}.js`),
        "export {};\n",
      );
    }
    const result = runPolicy(auditScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /packed file count exceeds 100/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("package audit enforces the own-package unpacked-size budget", () => {
  const root = makeTemporaryDirectory();
  try {
    makePackageFixture(root);
    writeFileSync(
      join(root, "dist", "oversized.js"),
      Buffer.alloc(1_500_001, 0x61),
    );
    const result = runPolicy(auditScript, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unpacked package size exceeds 1500000 bytes/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
