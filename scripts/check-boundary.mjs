#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(
  readFileSync("config/public-export-manifest.json", "utf8"),
);
const denylist = JSON.parse(
  readFileSync("config/public-export-denylist.json", "utf8"),
);
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const modes = execFileSync("git", ["ls-files", "-s"], { encoding: "utf8" });
const failures = [];

const allowedRoots = [
  ".github/workflows/",
  "bin/",
  "config/",
  "dist/",
  "docs/",
  "scripts/",
  "skills/",
  "src/",
  "tests/",
];
const allowedRootFiles = new Set([
  ".gitignore",
  ".prettierignore",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
]);

if (manifest.status !== "agent-tooling-v1")
  failures.push("manifest status must be agent-tooling-v1");
if (manifest.publicationClass !== "PUBLIC_PROTOCOL_AND_CLIENT_TOOLING_ONLY") {
  failures.push(
    "publication class must remain public protocol and client tooling only",
  );
}
if (manifest.defaultDecision !== "deny")
  failures.push("manifest must default deny");
if (manifest.historyMode !== "clean-unrelated")
  failures.push("clean unrelated history is required");
if (manifest.automaticExportAllowed !== false)
  failures.push("automatic export must remain disabled");
if (manifest.licenseSelected !== true || manifest.license !== "MIT") {
  failures.push("the reviewed package license must be MIT");
}
if (manifest.environmentTemplatePolicy?.copyCloudTemplate !== false) {
  failures.push("cloud environment template copying must remain forbidden");
}
if (denylist.defaultDecision !== "deny")
  failures.push("denylist must default deny");

for (const path of tracked) {
  if (
    !allowedRootFiles.has(path) &&
    !allowedRoots.some((root) => path.startsWith(root))
  ) {
    failures.push(`path is outside the public allowlist: ${path}`);
  }
  if (/(^|\/)\.env(?:\.|$)/i.test(path))
    failures.push(`environment file is forbidden: ${path}`);
  if (path === ".var/private" || path.startsWith(".var/private/")) {
    failures.push(`private artifact path is forbidden: ${path}`);
  }
}
if (/^120000 /m.test(modes)) failures.push("symlinks are not allowed");

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}
process.stdout.write("PUBLIC_AGENT_TOOLING_BOUNDARY_VALID\n");
