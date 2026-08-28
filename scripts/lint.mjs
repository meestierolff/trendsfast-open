#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

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

const TELEMETRY_DEPENDENCIES = [
  /^@opentelemetry\//i,
  /^@sentry\//i,
  /^(?:analytics-node|amplitude|datadog|mixpanel|newrelic|posthog|posthog-node|segment)$/i,
];

const RUNTIME_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
]);
const RUNTIME_ROOTS = ["bin", "dist", "skills", "src"];
const ALLOWED_ENVIRONMENT_NAMES = new Set([
  "APPDATA",
  "TRENDSFAST_API_KEY",
  "TRENDSFAST_PACKAGE_SOURCE",
  "TRENDSFAST_TEST_MODE",
  "XDG_CONFIG_HOME",
]);
const ALLOWED_RUNTIME_URL_PATHS = new Set(["/api/mcp", "/mcp"]);
const ALLOWED_SCRIPTS = new Map([
  ["boundary", "node scripts/check-boundary.mjs"],
  ["build", "tsc -p tsconfig.json"],
  [
    "check",
    "npm run boundary && npm run format:check && npm run lint && npm run typecheck && npm test && npm run secret:scan && npm run package:audit",
  ],
  ["format", "prettier --write ."],
  ["format:check", "prettier --check ."],
  ["lint", "node scripts/lint.mjs"],
  ["package:audit", "node scripts/package-audit.mjs"],
  ["secret:scan", "node scripts/secret-scan.mjs"],
  ["test", "npm run build && node --test tests/*.test.mjs"],
  ["typecheck", "tsc -p tsconfig.json --noEmit"],
]);

const CONTENT_RULES = [
  {
    id: "telemetry-sdk",
    expression:
      /(?:@opentelemetry\/|@sentry\/|analytics-node|amplitude(?:-node)?|datadog|mixpanel|newrelic|posthog(?:-node)?|segment\.io)/i,
  },
  {
    id: "telemetry-credential",
    expression:
      /(?:AMPLITUDE_API_KEY|DATADOG_API_KEY|MIXPANEL_TOKEN|NEW_RELIC_LICENSE_KEY|POSTHOG_KEY|SEGMENT_WRITE_KEY|SENTRY_DSN)/,
  },
  {
    id: "managed-provider-implementation",
    expression: /(?:dataforseo|scrapecreators|serpapi|value-serp)/i,
  },
  {
    id: "private-cloud-reference",
    expression:
      /(?:trendsfast-cloud|\.var\/private|dogfood-private|operations-records)/i,
  },
  {
    id: "privileged-environment-reference",
    expression:
      /(?:DATABASE_URL|DIRECT_URL|PGPASSWORD|SUPABASE_SERVICE_ROLE|STRIPE_SECRET|VERCEL_AUTOMATION_BYPASS_SECRET|VERCEL_BYPASS_TOKEN|API_KEY_PEPPER)/,
  },
  {
    id: "private-service-sdk",
    expression:
      /(?:from\s*|import\s*\()?['"](?:@anthropic-ai\/sdk|@supabase\/supabase-js|openai|pg|postgres|stripe)['"]/i,
  },
  {
    id: "private-endpoint",
    expression:
      /['"]https:\/\/trendsfast\.com\/api\/(?:admin|internal|ops)(?:\/|['"])/i,
  },
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseRoot(argv) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--root" || index + 1 >= argv.length) {
      fail("usage: lint.mjs [--root DIRECTORY]");
    }
    root = resolve(argv[index + 1]);
    index += 1;
  }
  return root;
}

function safePath(root, path) {
  return relative(root, path)
    .replaceAll("\\", "/")
    .replace(/[\u0000-\u001f\u007f]/g, "?");
}

function collectRuntimeFiles(root, failures) {
  const files = [];

  function visit(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      failures.push(`runtime symlink is forbidden: ${safePath(root, path)}`);
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        visit(resolve(path, entry.name));
      }
      return;
    }
    if (stat.isFile() && RUNTIME_EXTENSIONS.has(extname(path).toLowerCase()))
      files.push(path);
  }

  for (const directory of RUNTIME_ROOTS) {
    const path = resolve(root, directory);
    if (existsSync(path)) visit(path);
  }
  return files;
}

function lineNumber(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1)
    if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

const root = parseRoot(process.argv.slice(2));
const packagePath = resolve(root, "package.json");
if (!existsSync(packagePath)) fail("package.json is required");

let packageJson;
try {
  packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
} catch {
  fail("package.json must contain valid JSON");
}

const failures = [];
const scripts = packageJson.scripts ?? {};
for (const name of Object.keys(scripts)) {
  if (LIFECYCLE_SCRIPTS.has(name))
    failures.push(`npm lifecycle script is forbidden: ${name}`);
}

for (const [name, command] of Object.entries(scripts)) {
  if (typeof command !== "string") {
    failures.push(`npm script must be a string: ${name}`);
    continue;
  }
  if (ALLOWED_SCRIPTS.get(name) !== command) {
    failures.push(`npm script is outside the exact allowlist: ${name}`);
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

const dependencyGroups = [
  packageJson.dependencies,
  packageJson.devDependencies,
  packageJson.optionalDependencies,
  packageJson.peerDependencies,
];
for (const dependencies of dependencyGroups) {
  for (const name of Object.keys(dependencies ?? {})) {
    if (TELEMETRY_DEPENDENCIES.some((expression) => expression.test(name))) {
      failures.push(`telemetry dependency is forbidden: ${name}`);
    }
  }
}

for (const path of collectRuntimeFiles(root, failures)) {
  const text = readFileSync(path, "utf8");
  const relativePath = safePath(root, path);
  for (const rule of CONTENT_RULES) {
    const match = rule.expression.exec(text);
    rule.expression.lastIndex = 0;
    if (match) {
      failures.push(
        `${rule.id} is forbidden: ${relativePath}:${lineNumber(text, match.index)}`,
      );
    }
  }

  if (
    [".cjs", ".js", ".mjs", ".ts", ".tsx"].includes(extname(path).toLowerCase())
  ) {
    for (const match of text.matchAll(
      /\b(?:env|environment)\.([A-Z][A-Z0-9_]*)/g,
    )) {
      if (!ALLOWED_ENVIRONMENT_NAMES.has(match[1])) {
        failures.push(
          `unreviewed environment access is forbidden: ${relativePath}:${lineNumber(text, match.index)}`,
        );
      }
    }

    const fetchMatch = /\bfetch\s*\(/.exec(text);
    if (fetchMatch && !/(?:^|\/)remote\.(?:js|ts)$/.test(relativePath)) {
      failures.push(
        `network access outside the reviewed MCP transport is forbidden: ${relativePath}:${lineNumber(text, fetchMatch.index)}`,
      );
    }

    const urls = text.matchAll(/https?:\/\/[^\s'"`<>()]+/g);
    for (const match of urls) {
      let url;
      try {
        url = new URL(match[0]);
      } catch {
        failures.push(
          `invalid URL literal: ${relativePath}:${lineNumber(text, match.index)}`,
        );
        continue;
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "trendsfast.com" ||
        !ALLOWED_RUNTIME_URL_PATHS.has(url.pathname) ||
        url.search !== "" ||
        url.hash !== ""
      ) {
        failures.push(
          `unreviewed runtime URL is forbidden: ${relativePath}:${lineNumber(text, match.index)}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of [...new Set(failures)].sort())
    process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write("PUBLIC_AGENT_LINT_VALID\n");
