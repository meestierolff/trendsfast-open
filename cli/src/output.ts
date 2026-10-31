/** Files the CLI writes for an agent to read in bounded slices instead of in its context. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const OUTPUT_DIRECTORY = ".trendsfast";

/** Creates `.trendsfast/` with a `.gitignore` of its own, so collected posts are never
 * committed even where the project's own .gitignore does not mention the directory. */
export function ensureOutputDirectory(cwd: string): string {
  const directory = join(cwd, OUTPUT_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const ignore = join(directory, ".gitignore");
  if (!existsSync(ignore))
    writeFileSync(ignore, "# Written by the trendsfast CLI: collected posts are third-party text.\n*\n");
  return directory;
}

/**
 * Where `-o <path>` writes. A bare file name goes into `.trendsfast/`; a path ending in `/`
 * is a directory and gets a generated name; any other path is used as given.
 */
export function outputPath(requested: string, cwd: string, generatedName: string): string {
  if (requested.endsWith("/") || requested.endsWith("\\")) {
    const directory = isAbsolute(requested) ? requested : resolve(cwd, requested);
    if (resolve(directory) === resolve(cwd, OUTPUT_DIRECTORY)) ensureOutputDirectory(cwd);
    else mkdirSync(directory, { recursive: true });
    return join(directory, generatedName);
  }
  if (basename(requested) === requested) return join(ensureOutputDirectory(cwd), requested);
  const path = isAbsolute(requested) ? requested : resolve(cwd, requested);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

/** `customers-2026-10-31-6f1c2d3e.json` */
export function generatedName(label: string, id: string, now: Date): string {
  return `${label}-${now.toISOString().slice(0, 10)}-${id.slice(0, 8)}.json`;
}

export function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
