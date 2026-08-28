#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const EXPECTED_PACKAGE_NAME = "trendsfast-agent";
const MAX_RUNTIME_DEPENDENCIES = 3;
const MAX_PACKED_FILES = 100;
const MAX_UNPACKED_BYTES = 1_500_000;

const REQUIRED_RUNTIME_DEPENDENCIES = new Map([
  ["@modelcontextprotocol/server", "2.0.0"],
  ["smol-toml", "1.8.0"],
]);

const ALLOWED_DEV_DEPENDENCIES = new Map([
  ["@modelcontextprotocol/client", "2.0.0"],
  ["@types/node", "22.20.1"],
  ["prettier", "3.9.6"],
  ["typescript", "7.0.2"],
]);

const ALLOWED_LOCK_PACKAGES = new Map([
  ["@modelcontextprotocol/client", "2.0.0"],
  ["@modelcontextprotocol/core", "2.0.0"],
  ["@modelcontextprotocol/server", "2.0.0"],
  ["@types/node", "22.20.1"],
  ["@typescript/typescript-aix-ppc64", "7.0.2"],
  ["@typescript/typescript-darwin-arm64", "7.0.2"],
  ["@typescript/typescript-darwin-x64", "7.0.2"],
  ["@typescript/typescript-freebsd-arm64", "7.0.2"],
  ["@typescript/typescript-freebsd-x64", "7.0.2"],
  ["@typescript/typescript-linux-arm", "7.0.2"],
  ["@typescript/typescript-linux-arm64", "7.0.2"],
  ["@typescript/typescript-linux-loong64", "7.0.2"],
  ["@typescript/typescript-linux-mips64el", "7.0.2"],
  ["@typescript/typescript-linux-ppc64", "7.0.2"],
  ["@typescript/typescript-linux-riscv64", "7.0.2"],
  ["@typescript/typescript-linux-s390x", "7.0.2"],
  ["@typescript/typescript-linux-x64", "7.0.2"],
  ["@typescript/typescript-netbsd-arm64", "7.0.2"],
  ["@typescript/typescript-netbsd-x64", "7.0.2"],
  ["@typescript/typescript-openbsd-arm64", "7.0.2"],
  ["@typescript/typescript-openbsd-x64", "7.0.2"],
  ["@typescript/typescript-sunos-x64", "7.0.2"],
  ["@typescript/typescript-win32-arm64", "7.0.2"],
  ["@typescript/typescript-win32-x64", "7.0.2"],
  ["cross-spawn", "7.0.6"],
  ["eventsource", "3.0.7"],
  ["eventsource-parser", "3.1.1"],
  ["isexe", "2.0.0"],
  ["jose", "6.2.10"],
  ["path-key", "3.1.1"],
  ["pkce-challenge", "5.0.1"],
  ["prettier", "3.9.6"],
  ["shebang-command", "2.0.0"],
  ["shebang-regex", "3.0.0"],
  ["smol-toml", "1.8.0"],
  ["typescript", "7.0.2"],
  ["undici-types", "6.21.0"],
  ["which", "2.0.2"],
  ["zod", "4.4.3"],
]);

const ALLOWED_LICENSES = new Set(["Apache-2.0", "BSD-3-Clause", "ISC", "MIT"]);
const REQUIRED_SCRIPTS = {
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
const REQUIRED_DECLARED_FILES = new Set([
  "LICENSE",
  "README.md",
  "bin/",
  "dist/",
  "skills/trendsfast/SKILL.md",
]);
const REQUIRED_PACKED_FILES = new Set([
  "LICENSE",
  "README.md",
  "bin/trendsfast.js",
  "dist/cli.js",
  "package.json",
  "skills/trendsfast/SKILL.md",
]);
const ALLOWED_PACKED_FILES = new Set([
  ...REQUIRED_PACKED_FILES,
  "dist/bridge.js",
  "dist/clients.js",
  "dist/config.js",
  "dist/constants.js",
  "dist/endpoint.js",
  "dist/errors.js",
  "dist/files.js",
  "dist/index.js",
  "dist/package-source.js",
  "dist/remote.js",
]);

const LIFECYCLE_SCRIPTS = new Set([
  "dependencies",
  "install",
  "postinstall",
  "postdependencies",
  "postpack",
  "postprepare",
  "postpublish",
  "postrestart",
  "poststart",
  "poststop",
  "postuninstall",
  "postversion",
  "preinstall",
  "predependencies",
  "prepack",
  "prepare",
  "preprepare",
  "prepublish",
  "prepublishOnly",
  "prerestart",
  "prestart",
  "prestop",
  "preuninstall",
  "preversion",
  "publish",
  "restart",
  "postshrinkwrap",
  "preshrinkwrap",
  "shrinkwrap",
  "start",
  "stop",
  "uninstall",
  "version",
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseRoot(argv) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--root" || index + 1 >= argv.length) {
      fail("usage: package-audit.mjs [--root DIRECTORY]");
    }
    root = resolve(argv[index + 1]);
    index += 1;
  }
  return root;
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${description} must contain valid JSON`);
  }
}

function sameRecord(left, right) {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function lockPackageName(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index === -1 ? null : path.slice(index + marker.length);
}

function safePath(path) {
  return String(path)
    .replaceAll("\\", "/")
    .replace(/[\u0000-\u001f\u007f]/g, "?")
    .slice(0, 240);
}

function isAllowedPackedPath(path) {
  return ALLOWED_PACKED_FILES.has(path);
}

function sanitizedEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      /(?:API[_-]?KEY|AUTH_TOKEN|DATABASE_URL|PASSWORD|SECRET|TOKEN|(?:^|_)AUTH(?:_|$))/i.test(
        name,
      )
    ) {
      delete environment[name];
    }
  }
  return { ...environment, ...overrides };
}

function npmPackDryRun(root) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "trendsfast-package-audit-"),
  );
  try {
    const output = execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      {
        cwd: root,
        encoding: "utf8",
        env: sanitizedEnvironment({
          npm_config_audit: "false",
          npm_config_cache: resolve(temporaryDirectory, "npm-cache"),
          npm_config_fund: "false",
          npm_config_ignore_scripts: "true",
          npm_config_loglevel: "silent",
          npm_config_offline: "true",
          npm_config_update_notifier: "false",
          npm_config_userconfig: resolve(temporaryDirectory, "npmrc"),
        }),
        maxBuffer: 5_000_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed) || parsed.length !== 1)
      throw new Error("unexpected pack result");
    return parsed[0];
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

const root = parseRoot(process.argv.slice(2));
const packagePath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
if (!existsSync(packagePath)) fail("package.json is required");
if (!existsSync(lockPath)) fail("package-lock.json is required");

const packageJson = readJson(packagePath, "package.json");
const packageLock = readJson(lockPath, "package-lock.json");
const failures = [];

if (packageJson.name !== EXPECTED_PACKAGE_NAME)
  failures.push("package name must be trendsfast-agent");
if (packageJson.version !== "0.1.0-alpha.0") {
  failures.push(
    "package version must remain the reviewed 0.1.0-alpha.0 prerelease",
  );
}
if (packageJson.type !== "module") failures.push("package type must be module");
if (packageJson.license !== "MIT") failures.push("package license must be MIT");
if (packageJson.private === true)
  failures.push("package must not be marked private");
if (!sameRecord(packageJson.engines, { node: ">=22" }))
  failures.push("Node engine must be exactly >=22");
if (
  !sameRecord(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/meestierolff/trendsfast-open.git",
  })
) {
  failures.push(
    "repository URL must identify the clean public repository exactly",
  );
}
if (packageJson.homepage !== "https://trendsfast.com/mcp") {
  failures.push(
    "package homepage must identify the public MCP documentation exactly",
  );
}
if (
  packageJson.bugs !== "https://github.com/meestierolff/trendsfast-open/issues"
) {
  failures.push(
    "package issue URL must identify the clean public repository exactly",
  );
}
if (!sameRecord(packageJson.publishConfig, { access: "public", tag: "next" })) {
  failures.push("publishConfig must remain public on the next tag");
}
if (
  packageJson.exports !== undefined ||
  packageJson.main !== undefined ||
  packageJson.types !== undefined
) {
  failures.push(
    "the CLI-and-skill package must not expose a public library entrypoint",
  );
}
if (!sameRecord(packageJson.bin, { trendsfast: "bin/trendsfast.js" })) {
  failures.push("package binary allowlist must contain only bin/trendsfast.js");
}

const declaredFiles = new Set(packageJson.files ?? []);
if (
  declaredFiles.size !== REQUIRED_DECLARED_FILES.size ||
  [...REQUIRED_DECLARED_FILES].some((path) => !declaredFiles.has(path))
) {
  failures.push(
    "package files allowlist does not match the reviewed public payload",
  );
}

const runtimeDependencies = Object.entries(packageJson.dependencies ?? {});
if (runtimeDependencies.length > MAX_RUNTIME_DEPENDENCIES) {
  failures.push(`runtime dependency count exceeds ${MAX_RUNTIME_DEPENDENCIES}`);
}
if (
  !sameRecord(
    packageJson.dependencies,
    Object.fromEntries(REQUIRED_RUNTIME_DEPENDENCIES),
  )
) {
  failures.push("runtime dependencies must match the exact reviewed allowlist");
}

for (const [name, version] of Object.entries(
  packageJson.devDependencies ?? {},
)) {
  if (ALLOWED_DEV_DEPENDENCIES.get(name) !== version) {
    failures.push(
      `development dependency is outside the exact allowlist: ${name}`,
    );
  }
}
for (const group of [
  "bundledDependencies",
  "bundleDependencies",
  "optionalDependencies",
  "peerDependencies",
]) {
  const value = packageJson[group];
  if (
    Array.isArray(value)
      ? value.length > 0
      : value && Object.keys(value).length > 0
  ) {
    failures.push(`${group} are not allowed`);
  }
}

for (const name of Object.keys(packageJson.scripts ?? {})) {
  if (LIFECYCLE_SCRIPTS.has(name))
    failures.push(`npm lifecycle script is forbidden: ${name}`);
}
if (!sameRecord(packageJson.scripts, REQUIRED_SCRIPTS)) {
  failures.push("npm scripts must match the exact reviewed allowlist");
}
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (typeof command !== "string") {
    failures.push(`npm script must be a string: ${name}`);
    continue;
  }
  if (
    /\bnpm\s+(?:access|adduser|deprecate|dist-tag|login|owner|publish|token|unpublish|version)\b/i.test(
      command,
    )
  ) {
    failures.push(
      `registry-mutating npm command is forbidden in script: ${name}`,
    );
  }
}

if (packageLock.lockfileVersion !== 3)
  failures.push("package-lock.json must use lockfileVersion 3");
if (
  packageLock.name !== packageJson.name ||
  packageLock.version !== packageJson.version
) {
  failures.push("package-lock top-level identity must match package.json");
}
const lockRoot = packageLock.packages?.[""];
if (
  !lockRoot ||
  lockRoot.name !== packageJson.name ||
  lockRoot.version !== packageJson.version
) {
  failures.push("package-lock root identity must match package.json");
} else {
  if (lockRoot.license !== "MIT")
    failures.push("package-lock root license must be MIT");
  if (!sameRecord(lockRoot.bin, packageJson.bin)) {
    failures.push("package-lock root binary must match package.json");
  }
  if (!sameRecord(lockRoot.engines, packageJson.engines)) {
    failures.push("package-lock root engines must match package.json");
  }
  if (!sameRecord(lockRoot.dependencies, packageJson.dependencies)) {
    failures.push("package-lock runtime dependencies must match package.json");
  }
  if (!sameRecord(lockRoot.devDependencies, packageJson.devDependencies)) {
    failures.push(
      "package-lock development dependencies must match package.json",
    );
  }
}

for (const [path, metadata] of Object.entries(packageLock.packages ?? {})) {
  if (path === "") continue;
  const name = lockPackageName(path);
  if (!name || !ALLOWED_LOCK_PACKAGES.has(name)) {
    failures.push(
      `lockfile package is outside the allowlist: ${name ?? safePath(path)}`,
    );
    continue;
  }
  if (metadata.version !== ALLOWED_LOCK_PACKAGES.get(name)) {
    failures.push(`lockfile package version is outside the allowlist: ${name}`);
  }
  if (!ALLOWED_LICENSES.has(metadata.license)) {
    failures.push(`dependency license is outside the allowlist: ${name}`);
  }
  if (metadata.hasInstallScript === true)
    failures.push(`dependency install hook is forbidden: ${name}`);
  if (metadata.link === true)
    failures.push(`linked dependency is forbidden: ${name}`);
  if (
    typeof metadata.resolved !== "string" ||
    !metadata.resolved.startsWith("https://registry.npmjs.org/")
  ) {
    failures.push(
      `dependency must resolve from the official npm registry: ${name}`,
    );
  }
  if (
    typeof metadata.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{80,}={0,2}$/.test(metadata.integrity)
  ) {
    failures.push(`dependency must have sha512 integrity: ${name}`);
  }
}

for (const [name, version] of [
  ...REQUIRED_RUNTIME_DEPENDENCIES,
  ...Object.entries(packageJson.devDependencies ?? {}),
]) {
  const metadata = packageLock.packages?.[`node_modules/${name}`];
  if (!metadata || metadata.version !== version) {
    failures.push(`exact lockfile entry is required: ${name}@${version}`);
  }
}

let packResult;
try {
  packResult = npmPackDryRun(root);
} catch {
  failures.push("npm pack dry run must complete without lifecycle scripts");
}

if (packResult) {
  const files = Array.isArray(packResult.files) ? packResult.files : [];
  if (files.length > MAX_PACKED_FILES) {
    failures.push(`packed file count exceeds ${MAX_PACKED_FILES}`);
  }
  if (packResult.entryCount !== files.length)
    failures.push("npm pack entry count is inconsistent");
  if (
    !Number.isSafeInteger(packResult.unpackedSize) ||
    packResult.unpackedSize < 0 ||
    packResult.unpackedSize > MAX_UNPACKED_BYTES
  ) {
    failures.push(`unpacked package size exceeds ${MAX_UNPACKED_BYTES} bytes`);
  }

  const packedPaths = new Set();
  let summedSize = 0;
  for (const file of files) {
    const path = file?.path;
    if (typeof path !== "string") {
      failures.push("npm pack returned a file without a path");
      continue;
    }
    packedPaths.add(path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      failures.push(`packed file has an invalid size: ${safePath(path)}`);
    } else {
      summedSize += file.size;
    }
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      !isAllowedPackedPath(path)
    ) {
      failures.push(`packed path is outside the allowlist: ${safePath(path)}`);
      continue;
    }
    const absolutePath = resolve(root, path);
    if (
      !absolutePath.startsWith(`${root}${sep}`) ||
      !existsSync(absolutePath)
    ) {
      failures.push(
        `packed path does not resolve to a local file: ${safePath(path)}`,
      );
    } else if (lstatSync(absolutePath).isSymbolicLink()) {
      failures.push(`packed symlink is forbidden: ${safePath(path)}`);
    }
  }
  for (const path of REQUIRED_PACKED_FILES) {
    if (!packedPaths.has(path))
      failures.push(`required packed file is missing: ${path}`);
  }
  if (summedSize !== packResult.unpackedSize)
    failures.push("npm pack unpacked size is inconsistent");
}

if (
  !existsSync(resolve(root, "LICENSE")) ||
  !readFileSync(resolve(root, "LICENSE"), "utf8").startsWith("MIT License\n")
) {
  failures.push("LICENSE must contain the reviewed MIT license text");
}

if (failures.length > 0) {
  for (const failure of [...new Set(failures)].sort())
    process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write("PACKAGE_AUDIT_VALID\n");
