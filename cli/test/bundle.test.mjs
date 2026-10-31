import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { packageRoot } from "./helpers.mjs";

function files(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

function sameTree(copy, source) {
  assert.deepEqual(files(copy), files(source));
  for (const file of files(source)) assert.equal(readFileSync(join(copy, file), "utf8"), readFileSync(join(source, file), "utf8"), file);
}

describe("what the package bundles", () => {
  it("ships the skills exactly as the agent kit has them", () => sameTree(join(packageRoot, "skills"), join(packageRoot, "..", "skills")));

  it("compiles in the SDK exactly as sdk-js has it", () => sameTree(join(packageRoot, "src", "sdk"), join(packageRoot, "..", "sdk-js", "src")));

  it("has no runtime dependencies and reports its own version", async () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    assert.deepEqual(pkg.dependencies ?? {}, {});
    assert.equal(pkg.bin.trendsfast, "dist/cli.js");
    assert.deepEqual(pkg.files, ["dist", "skills"]);
    const { CLI_VERSION } = await import(new URL("../dist/version.js", import.meta.url).href);
    assert.equal(CLI_VERSION, pkg.version);
    assert.equal(statSync(join(packageRoot, "dist", "cli.js")).mode & 0o111, 0o111, "the bin is executable");
    assert.match(readFileSync(join(packageRoot, "dist", "cli.js"), "utf8"), /^#!\/usr\/bin\/env node\n/);
  });
});
