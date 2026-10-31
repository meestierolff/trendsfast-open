// Copies what the published CLI bundles from its siblings, so it keeps zero runtime
// dependencies: the SDK's sources (compiled in) and the agent skills `trendsfast init`
// installs. Both are build artifacts, ignored by git; test/bundle.test.mjs checks that the
// copies still equal their sources.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const copies = [
  [here("../../sdk-js/src"), here("../src/sdk")],
  [here("../../skills"), here("../skills")],
];
for (const [from, to] of copies) {
  if (!existsSync(from)) throw new Error(`Missing ${from}: the CLI is built from inside the agent kit.`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (path) => !/(^|\/)\.[^/]+$/.test(path) || path === from });
}
