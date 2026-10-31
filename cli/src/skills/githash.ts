/**
 * The git tree hash of a directory, computed offline the way git does. `npx skills` records a
 * skill folder's GitHub tree SHA as `skillFolderHash` in `~/.agents/.skill-lock.json`, so a
 * hash computed here matches the published folder when the contents match: the two
 * installers then agree on what is current, and either can tell whether a file was changed.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function objectHash(type: "blob" | "tree", body: Buffer): Buffer {
  return createHash("sha1").update(`${type} ${body.length}\0`).update(body).digest();
}

function treeHash(directory: string): Buffer {
  const entries = readdirSync(directory).map((name) => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return { sortKey: `${name}/`, entry: Buffer.concat([Buffer.from(`40000 ${name}\0`), treeHash(path)]) };
    const executable = (statSync(path).mode & 0o111) !== 0;
    const blob = objectHash("blob", readFileSync(path));
    return { sortKey: name, entry: Buffer.concat([Buffer.from(`${executable ? "100755" : "100644"} ${name}\0`), blob]) };
  });
  entries.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return objectHash("tree", Buffer.concat(entries.map((entry) => entry.entry)));
}

/** The hex git tree hash of `directory`, or null when it cannot be read. */
export function gitTreeHash(directory: string): string | null {
  try {
    return treeHash(directory).toString("hex");
  } catch {
    return null;
  }
}
