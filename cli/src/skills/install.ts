/**
 * Installs the bundled skills the way `npx skills` lays them out, so the two interoperate:
 *
 * 1. a canonical copy of each skill in `~/.agents/skills/<name>`;
 * 2. a relative symlink to it (a copy where symlinks fail) in the global skills directory
 *    of every coding agent that is installed here, and nowhere else;
 * 3. an entry per skill in `~/.agents/.skill-lock.json` (version 3), whose
 *    `skillFolderHash` is the folder's git tree hash.
 *
 * The lock entry is also how this installer knows what it owns: a folder is replaced only
 * when its current hash still equals the hash recorded when it was installed from this
 * source. A folder someone changed, or one another source installed, is kept unless
 * `--force`.
 */
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Env } from "../sdk/credentials.js";
import { gitTreeHash } from "./githash.js";
import { canonicalSkillsDir, harnesses, skillLockPath, type Harness } from "./targets.js";

export const SKILL_SOURCE = "meestierolff/trendsfast-open";
export const SKILL_SOURCE_URL = "https://github.com/meestierolff/trendsfast-open.git";

export interface BundledSkill {
  name: string;
  dir: string;
  hash: string;
}

export type SkillAction =
  | "installed"
  | "updated"
  | "current"
  | "replaced"
  | "kept-changed"
  | "kept-other-source";
export type LinkAction = "linked" | "copied" | "current" | "replaced" | "kept-changed" | "kept-other";

export interface HarnessReport {
  id: string;
  name: string;
  skillsDir: string;
  links: { name: string; action: LinkAction }[];
}

export interface InstallReport {
  canonicalDir: string;
  lockPath: string;
  lockNote: string | null;
  skills: { name: string; action: SkillAction }[];
  harnesses: HarnessReport[];
  /** Agents asked for with --agent that are not installed here; nothing was written for them. */
  notInstalled: string[];
  unknownAgents: string[];
}

interface LockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath: string;
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface LockFile {
  version: number;
  skills: Record<string, LockEntry>;
  [key: string]: unknown;
}

/** The skills bundled with this CLI: each directory holding a SKILL.md, named by its
 * frontmatter `name`. */
export function bundledSkills(bundleDir: string): BundledSkill[] {
  if (!existsSync(bundleDir)) return [];
  return readdirSync(bundleDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(bundleDir, entry.name, "SKILL.md")))
    .map((entry) => {
      const dir = join(bundleDir, entry.name);
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(dir, "SKILL.md"), "utf8"))?.[1] ?? "";
      const name = /^name:\s*(\S+)\s*$/m.exec(frontmatter)?.[1] ?? entry.name;
      return { name, dir, hash: gitTreeHash(dir) ?? "" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function installedHarnesses(env: Env): Harness[] {
  return harnesses(env).filter((harness) => {
    try {
      return statSync(harness.detectDir).isDirectory();
    } catch {
      return false;
    }
  });
}

function readLock(path: string): { lock: LockFile; writable: boolean; note: string | null } {
  if (!existsSync(path)) return { lock: { version: 3, skills: {} }, writable: true, note: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LockFile;
    if (parsed.version !== 3 || typeof parsed.skills !== "object" || parsed.skills === null)
      return {
        lock: { version: 3, skills: {} },
        writable: false,
        note: `${path} has a format this CLI does not know (version ${String(parsed.version)}); it was left untouched.`,
      };
    return { lock: parsed, writable: true, note: null };
  } catch {
    return { lock: { version: 3, skills: {} }, writable: false, note: `${path} could not be read; it was left untouched.` };
  }
}

/** Copies a directory tree, leaving out dotfiles. (fs.cpSync is still experimental on Node 20.) */
function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}

function copySkill(from: string, to: string): void {
  const temporary = `${to}.tmp-${randomBytes(4).toString("hex")}`;
  copyTree(from, temporary);
  rmSync(to, { recursive: true, force: true });
  renameSync(temporary, to);
}

function linkSkill(target: string, link: string, platform: NodeJS.Platform): "linked" | "copied" {
  rmSync(link, { recursive: true, force: true });
  try {
    if (platform === "win32") symlinkSync(target, link, "junction");
    else symlinkSync(relative(dirname(link), target), link, "dir");
    return "linked";
  } catch {
    copyTree(target, link);
    return "copied";
  }
}

export interface InstallOptions {
  env: Env;
  bundleDir: string;
  /** Limit to these agent ids. Agents that are not installed are never written to. */
  agents?: string[];
  force?: boolean;
  /** Report what would happen, writing nothing. */
  dryRun?: boolean;
  now: Date;
  platform: NodeJS.Platform;
}

export function installSkills(options: InstallOptions): InstallReport {
  const { env, force = false, dryRun = false } = options;
  const skills = bundledSkills(options.bundleDir);
  const canonicalDir = canonicalSkillsDir(env);
  const lockPath = skillLockPath(env);
  const { lock, writable, note } = readLock(lockPath);
  const known = harnesses(env);
  const installed = new Set(installedHarnesses(env).map((harness) => harness.id));
  const requested = options.agents?.length ? options.agents : null;
  const unknownAgents = (requested ?? []).filter((id) => !known.some((harness) => harness.id === id));
  const notInstalled = (requested ?? []).filter((id) => known.some((h) => h.id === id) && !installed.has(id));
  const targets = known.filter((harness) => installed.has(harness.id) && (!requested || requested.includes(harness.id)));
  const now = options.now.toISOString();
  const entries: Record<string, LockEntry> = {};
  const report: InstallReport = {
    canonicalDir,
    lockPath,
    lockNote: note,
    skills: [],
    harnesses: [],
    notInstalled,
    unknownAgents,
  };

  if (!dryRun) mkdirSync(canonicalDir, { recursive: true });
  for (const skill of skills) {
    const destination = join(canonicalDir, skill.name);
    const entry = lock.skills[skill.name];
    const ours = entry?.source === SKILL_SOURCE;
    let action: SkillAction;
    if (!existsSync(destination)) action = "installed";
    else {
      const current = gitTreeHash(destination);
      if (current === skill.hash) action = "current";
      else if (ours && entry?.skillFolderHash === current) action = "updated";
      else if (force) action = "replaced";
      else action = ours ? "kept-changed" : "kept-other-source";
    }
    if (!dryRun && (action === "installed" || action === "updated" || action === "replaced")) copySkill(skill.dir, destination);
    if (action !== "kept-changed" && action !== "kept-other-source")
      entries[skill.name] = {
        source: SKILL_SOURCE,
        sourceType: "github",
        sourceUrl: SKILL_SOURCE_URL,
        skillPath: `skills/${skill.name}/SKILL.md`,
        skillFolderHash: skill.hash,
        installedAt: entry?.installedAt && ours ? entry.installedAt : now,
        updatedAt: action === "current" && ours && entry ? entry.updatedAt : now,
      };
    report.skills.push({ name: skill.name, action });
  }

  for (const harness of targets) {
    const links: HarnessReport["links"] = [];
    if (!dryRun) mkdirSync(harness.skillsDir, { recursive: true });
    for (const skill of skills) {
      const canonical = join(canonicalDir, skill.name);
      const link = join(harness.skillsDir, skill.name);
      let action: LinkAction;
      let stat: ReturnType<typeof lstatSync> | null = null;
      try {
        stat = lstatSync(link);
      } catch {
        stat = null;
      }
      if (!stat) action = "linked";
      else if (stat.isSymbolicLink()) {
        let target = "";
        try {
          target = resolve(dirname(link), readlinkSync(link));
        } catch {
          target = "";
        }
        action = target === resolve(canonical) ? "current" : force ? "replaced" : "kept-other";
      } else if (stat.isDirectory()) {
        const hash = gitTreeHash(link);
        const recorded = lock.skills[skill.name];
        if (hash === skill.hash) action = "current";
        else if (recorded?.source === SKILL_SOURCE && recorded.skillFolderHash === hash) action = "replaced";
        else action = force ? "replaced" : "kept-changed";
      } else action = force ? "replaced" : "kept-other";
      if (!dryRun && (action === "linked" || action === "replaced")) {
        const made = linkSkill(canonical, link, options.platform);
        if (made === "copied" && action === "linked") action = "copied";
      }
      links.push({ name: skill.name, action });
    }
    report.harnesses.push({ id: harness.id, name: harness.name, skillsDir: harness.skillsDir, links });
  }

  if (!dryRun && writable && Object.keys(entries).length) {
    // Re-read just before writing, so an entry another installer added meanwhile survives.
    const fresh = readLock(lockPath);
    const base = fresh.writable ? fresh.lock : lock;
    const merged: LockFile = { ...base, version: 3, skills: { ...base.skills, ...entries } };
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(merged, null, 2)}\n`);
  }
  return report;
}
