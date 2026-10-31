import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { packageRoot, run, tempHome } from "./helpers.mjs";

const bundled = readdirSync(join(packageRoot, "skills")).filter((name) => existsSync(join(packageRoot, "skills", name, "SKILL.md"))).sort();
// The one skill's references load only when a task needs them, so each must install with it.
const references = readdirSync(join(packageRoot, "skills", "trendsfast", "references")).sort();

function homeWith(...agentDirs) {
  const { env, home } = tempHome();
  for (const dir of agentDirs) mkdirSync(join(home, dir), { recursive: true });
  return { env, home };
}

describe("trendsfast init", () => {
  it("bundles one skill, with a reference per product and workflow", () => {
    assert.deepEqual(bundled, ["trendsfast"]);
    for (const name of ["customers", "trending", "competitors", "formats", "search", "content-plan", "market-brief", "errors", "setup", "rest"])
      assert.ok(references.includes(`${name}.md`), name);
  });

  it("copies the skill and its references to ~/.agents/skills and links it only into the agents installed here", async () => {
    const { env, home } = homeWith(".claude", ".codex");
    const result = await run(["init", "--all", "--no-login"], { env });
    assert.equal(result.code, 0, result.stderr);
    for (const name of bundled) {
      const canonical = join(home, ".agents", "skills", name);
      assert.equal(readFileSync(join(canonical, "SKILL.md"), "utf8"), readFileSync(join(packageRoot, "skills", name, "SKILL.md"), "utf8"));
      for (const agent of [".claude", ".codex"]) {
        const link = join(home, agent, "skills", name);
        assert.ok(lstatSync(link).isSymbolicLink(), `${agent}/${name} is a link`);
        assert.ok(!readlinkSync(link).startsWith("/"), "the link is relative");
        assert.equal(resolve(dirname(link), readlinkSync(link)), canonical);
      }
    }
    for (const file of references)
      assert.equal(readFileSync(join(home, ".claude", "skills", "trendsfast", "references", file), "utf8"), readFileSync(join(packageRoot, "skills", "trendsfast", "references", file), "utf8"), file);
    for (const absent of [".cursor", ".gemini", ".config/opencode", ".openclaw"]) assert.ok(!existsSync(join(home, absent)), `${absent} was not created`);
    assert.match(result.stdout, /claude-code/);
    assert.match(result.stdout, /codex/);
    assert.match(result.stdout, /claude mcp add --transport http trendsfast/);
    assert.match(result.stdout, /codex mcp add trendsfast/);
  });

  it("records each skill in ~/.agents/.skill-lock.json the way npx skills does, keeping other entries", async () => {
    const { env, home } = homeWith(".claude");
    const lockPath = join(home, ".agents", ".skill-lock.json");
    mkdirSync(dirname(lockPath), { recursive: true });
    const other = { source: "someone/else", sourceType: "github", sourceUrl: "https://github.com/someone/else.git", skillPath: "skills/x/SKILL.md", skillFolderHash: "abc", installedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    writeFileSync(lockPath, JSON.stringify({ version: 3, skills: { other }, dismissed: { findSkillsPrompt: true } }));
    assert.equal((await run(["init", "--all", "--no-login"], { env })).code, 0);
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(lock.version, 3);
    assert.deepEqual(lock.skills.other, other);
    assert.deepEqual(lock.dismissed, { findSkillsPrompt: true });
    const entry = lock.skills.trendsfast;
    assert.equal(entry.source, "meestierolff/trendsfast-open");
    assert.equal(entry.sourceType, "github");
    assert.equal(entry.skillPath, "skills/trendsfast/SKILL.md");
    assert.match(entry.skillFolderHash, /^[0-9a-f]{40}$/);
  });

  it("is idempotent, and keeps a skill someone changed unless --force", async () => {
    const { env, home } = homeWith(".claude");
    assert.equal((await run(["init", "--all", "--no-login"], { env })).code, 0);
    const again = await run(["init", "--all", "--no-login"], { env });
    assert.match(again.stdout, /\(1\) → ~\/\.agents\/skills: 1 current/);
    const skill = join(home, ".agents", "skills", "trendsfast", "SKILL.md");
    writeFileSync(skill, "my own notes\n");
    const kept = await run(["init", "--all", "--no-login"], { env });
    assert.equal(readFileSync(skill, "utf8"), "my own notes\n");
    assert.match(kept.stdout, /trendsfast \(changed since it was installed\)/);
    const forced = await run(["init", "--all", "--no-login", "--force"], { env });
    assert.equal(forced.code, 0);
    assert.notEqual(readFileSync(skill, "utf8"), "my own notes\n");
  });

  it("leaves a skill folder another installer put there", async () => {
    const { env, home } = homeWith(".claude");
    const mine = join(home, ".claude", "skills", "trendsfast");
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, "SKILL.md"), "---\nname: trendsfast\ndescription: mine\n---\n");
    const result = await run(["init", "--all", "--no-login"], { env });
    assert.ok(!lstatSync(mine).isSymbolicLink());
    assert.match(readFileSync(join(mine, "SKILL.md"), "utf8"), /description: mine/);
    assert.match(result.stdout, /Kept as they are: claude-code\/trendsfast\./);
  });

  it("writes nothing for an agent that is not installed, even when asked", async () => {
    const { env, home } = homeWith(".claude");
    const result = await run(["init", "--agent", "cursor", "--no-login"], { env });
    assert.equal(result.code, 0);
    assert.ok(!existsSync(join(home, ".cursor")));
    assert.ok(!existsSync(join(home, ".claude", "skills")), "--agent limits the install");
    assert.match(result.stdout, /Not installed here, so nothing was written for: cursor/);
    assert.equal((await run(["init", "--agent", "notepad", "--no-login"], { env })).code, 1);
  });

  it("honours CLAUDE_CONFIG_DIR, CODEX_HOME and XDG_CONFIG_HOME", async () => {
    const { env, home } = tempHome();
    for (const dir of ["claude-config", "codex-home", ".config/opencode"]) mkdirSync(join(home, dir), { recursive: true });
    const result = await run(["init", "--all", "--no-login"], { env: { ...env, CLAUDE_CONFIG_DIR: join(home, "claude-config"), CODEX_HOME: join(home, "codex-home") } });
    assert.equal(result.code, 0, result.stderr);
    for (const dir of ["claude-config/skills", "codex-home/skills", ".config/opencode/skills"]) assert.ok(existsSync(join(home, dir, "trendsfast", "SKILL.md")), dir);
  });

  it("only reports on --dry-run", async () => {
    const { env, home } = homeWith(".claude");
    const result = await run(["init", "--dry-run"], { env });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Would install \(1\)/);
    assert.ok(!existsSync(join(home, ".agents")));
    assert.ok(!existsSync(join(home, ".claude", "skills")));
  });
});
