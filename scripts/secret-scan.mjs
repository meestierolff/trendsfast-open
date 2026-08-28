#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const MAX_SCAN_BYTES = 10_000_000;
const MAX_FINDINGS = 50;

const RULES = [
  {
    id: "private-key",
    expression: /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/,
  },
  {
    id: "npm-token",
    expression: /\bnpm_[A-Za-z0-9]{36,}\b/,
  },
  {
    id: "github-token",
    expression:
      /\b(?:gh[oprsu]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  {
    id: "aws-access-key",
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: "provider-secret",
    expression:
      /\b(?:sk-(?:ant-api\d{2}-|live-|proj-)?[A-Za-z0-9_-]{20,}|[rs]k_(?:live|test)_[A-Za-z0-9]{20,})\b/,
  },
  {
    id: "hosted-service-token",
    expression:
      /\b(?:AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/,
  },
  {
    id: "webhook-secret",
    expression: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{30,}/,
  },
  {
    id: "credential-url",
    expression:
      /\b(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis):\/\/[^\s:@/]+:[^\s@/]+@/i,
  },
  {
    id: "npm-auth-token",
    expression: /(?:^|\n)\s*(?:\/\/[^\s:]+\/)?_authToken\s*=\s*([^\s]{16,})/,
    valueIndex: 1,
  },
  {
    id: "assigned-secret",
    expression:
      /\b(?:api[_-]?key|api[_-]?key[_-]?pepper|auth[_-]?token|client[_-]?secret|database[_-]?url|password|private[_-]?key|secret|session[_-]?secret|token)\b\s*[:=]\s*["']?([A-Za-z0-9+/_=-]{16,})/i,
    valueIndex: 1,
  },
  {
    id: "assigned-jwt",
    expression:
      /\b(?:authorization|jwt|service[_-]?role[_-]?key|token)\b\s*[:=]\s*["']?(eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})/i,
    valueIndex: 1,
  },
  {
    id: "bearer-token",
    expression: /\bBearer\s+([A-Za-z0-9._~+/-]{24,})/i,
    valueIndex: 1,
  },
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseRoot(argv) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--root" || index + 1 >= argv.length) {
      fail("usage: secret-scan.mjs [--root DIRECTORY]");
    }
    root = resolve(argv[index + 1]);
    index += 1;
  }
  return root;
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

function run(command, args, root, encoding = "utf8", environment = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding,
    env: sanitizedEnvironment({
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_ignore_scripts: "true",
      npm_config_loglevel: "silent",
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
      ...environment,
    }),
    maxBuffer: MAX_SCAN_BYTES * 2,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function safePath(root, path) {
  return relative(root, path)
    .replaceAll("\\", "/")
    .replace(/[\u0000-\u001f\u007f]/g, "?")
    .slice(0, 240);
}

function safeArchivePath(path) {
  return path.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 240);
}

function isPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    /(?:example|placeholder|replace|sample|synthetic|test|your[_-])/.test(
      normalized,
    ) ||
    /^x+$/.test(normalized) ||
    new Set(normalized).size <= 3
  );
}

function lineNumber(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1)
    if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function scanBuffer(buffer, source, findings) {
  if (buffer.length > MAX_SCAN_BYTES) {
    findings.push(`${source}: file exceeds the safe scan size`);
    return;
  }
  const text = buffer.toString("utf8");
  for (const rule of RULES) {
    const expression = new RegExp(
      rule.expression.source,
      rule.expression.flags.includes("g")
        ? rule.expression.flags
        : `${rule.expression.flags}g`,
    );
    for (const match of text.matchAll(expression)) {
      const candidate = match[rule.valueIndex ?? 0] ?? "";
      if (rule.valueIndex !== undefined && isPlaceholder(candidate)) continue;
      findings.push(
        `${source}:${lineNumber(text, match.index)} rule=${rule.id}`,
      );
      if (findings.length >= MAX_FINDINGS) return;
    }
  }
}

function scanTracked(root, findings) {
  const output = run("git", ["ls-files", "-z"], root);
  const paths = output.split("\0").filter(Boolean);
  let scanned = 0;
  for (const path of paths) {
    const absolutePath = resolve(root, path);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
    scanBuffer(
      readFileSync(absolutePath),
      `tracked:${safePath(root, absolutePath)}`,
      findings,
    );
    scanned += 1;
    if (findings.length >= MAX_FINDINGS) break;
  }

  if (findings.length < MAX_FINDINGS) {
    const indexEntries = run("git", ["ls-files", "--stage", "-z"], root)
      .split("\0")
      .filter(Boolean);
    for (const entry of indexEntries) {
      const match = entry.match(/^\d+ ([0-9a-f]{40,64}) 0\t([\s\S]+)$/);
      if (!match) continue;
      const [, objectId, path] = match;
      const size = Number.parseInt(
        run("git", ["cat-file", "-s", objectId], root).trim(),
        10,
      );
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SCAN_BYTES) {
        findings.push(
          `index:${safePath(root, resolve(root, path))}: file exceeds the safe scan size`,
        );
        continue;
      }
      scanBuffer(
        run("git", ["cat-file", "blob", objectId], root, null),
        `index:${safePath(root, resolve(root, path))}`,
        findings,
      );
      scanned += 1;
      if (findings.length >= MAX_FINDINGS) break;
    }
  }
  return scanned;
}

function scanHistory(root, findings) {
  const shallow = run(
    "git",
    ["rev-parse", "--is-shallow-repository"],
    root,
  ).trim();
  if (shallow !== "false") {
    findings.push("history: full-history scan requires a non-shallow checkout");
    return 0;
  }

  const objects = run("git", ["rev-list", "--objects", "--all"], root)
    .split("\n")
    .map((line) => line.match(/^([0-9a-f]{40,64})(?:\s|$)/)?.[1])
    .filter(Boolean);
  let scanned = 0;
  for (const objectId of new Set(objects)) {
    if (run("git", ["cat-file", "-t", objectId], root).trim() !== "blob")
      continue;
    const size = Number.parseInt(
      run("git", ["cat-file", "-s", objectId], root).trim(),
      10,
    );
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SCAN_BYTES) {
      findings.push(
        `history:${objectId.slice(0, 12)}: blob exceeds the safe scan size`,
      );
      continue;
    }
    scanBuffer(
      run("git", ["cat-file", "blob", objectId], root, null),
      `history:${objectId.slice(0, 12)}`,
      findings,
    );
    scanned += 1;
    if (findings.length >= MAX_FINDINGS) break;
  }

  if (findings.length < MAX_FINDINGS) {
    const messages = run(
      "git",
      ["log", "--all", "--format=%B%x00"],
      root,
    ).split("\0");
    for (const [index, message] of messages.entries()) {
      if (!message) continue;
      scanBuffer(
        Buffer.from(message),
        `history-message:${index + 1}`,
        findings,
      );
      if (findings.length >= MAX_FINDINGS) break;
    }
  }
  return scanned;
}

function validateArchiveEntry(entry, findings) {
  const segments = entry.split("/");
  if (
    !entry.startsWith("package/") ||
    entry.startsWith("/") ||
    entry.includes("\\") ||
    segments.includes("..") ||
    entry.includes("\0")
  ) {
    findings.push(`tarball:${safeArchivePath(entry)}: unsafe archive path`);
    return false;
  }
  return true;
}

function scanTarball(root, findings) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "trendsfast-secret-scan-"),
  );
  try {
    const packOutput = run(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        temporaryDirectory,
      ],
      root,
      "utf8",
      {
        npm_config_cache: resolve(temporaryDirectory, "npm-cache"),
        npm_config_userconfig: resolve(temporaryDirectory, "npmrc"),
      },
    );
    let packResult;
    try {
      [packResult] = JSON.parse(packOutput);
    } catch {
      findings.push("tarball: npm pack did not return valid JSON");
      return 0;
    }
    if (!packResult || typeof packResult.filename !== "string") {
      findings.push("tarball: npm pack did not identify an archive");
      return 0;
    }
    const archive = resolve(temporaryDirectory, basename(packResult.filename));
    if (!existsSync(archive) || !archive.startsWith(`${temporaryDirectory}/`)) {
      findings.push(
        "tarball: npm pack archive was not confined to the temporary directory",
      );
      return 0;
    }

    const verbose = run("tar", ["-tvzf", archive], root);
    if (
      verbose
        .split("\n")
        .some((line) => line.startsWith("l") || line.startsWith("h"))
    ) {
      findings.push("tarball: links are forbidden");
    }

    if (!Array.isArray(packResult.files)) {
      findings.push("tarball: npm pack did not return a file inventory");
      return 0;
    }

    let scanned = 0;
    for (const file of packResult.files) {
      const path = file?.path;
      if (
        typeof path !== "string" ||
        path.length === 0 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        /[\u0000-\u001f\u007f]/.test(path)
      ) {
        findings.push("tarball: npm pack returned an unsafe file path");
        continue;
      }
      const entry = `package/${path}`;
      if (!validateArchiveEntry(entry, findings)) continue;
      const content = run("tar", ["-xOzf", archive, "--", entry], root, null);
      scanBuffer(content, `tarball:${safeArchivePath(entry)}`, findings);
      scanned += 1;
      if (findings.length >= MAX_FINDINGS) break;
    }
    return scanned;
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

const root = parseRoot(process.argv.slice(2));
const findings = [];
let trackedCount = 0;
let historyCount = 0;
let tarballCount = 0;

try {
  trackedCount = scanTracked(root, findings);
  if (findings.length < MAX_FINDINGS)
    historyCount = scanHistory(root, findings);
  if (findings.length < MAX_FINDINGS)
    tarballCount = scanTarball(root, findings);
} catch {
  fail("secret scan could not complete safely");
}

if (findings.length > 0) {
  for (const finding of [...new Set(findings)].sort())
    process.stderr.write(`${finding}\n`);
  process.exit(1);
}

process.stdout.write(
  `SECRET_SCAN_VALID tracked=${trackedCount} history=${historyCount} tarball=${tarballCount}\n`,
);
