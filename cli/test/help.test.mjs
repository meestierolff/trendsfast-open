import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "./helpers.mjs";

const COMMANDS = ["init", "login", "logout", "whoami", "doctor", "context", "credits", "quote", "history", "result", "request", "customers", "trending", "competitors", "formats", "search", "global", "niche", "ask", "discover"];

describe("help", () => {
  it("lists every command, its price, the exit codes and the agent sign-in path", async () => {
    const { code, stdout } = await run(["--help"]);
    assert.equal(code, 0);
    for (const command of COMMANDS) assert.match(stdout, new RegExp(`^  ${command} `, "m"), command);
    for (const [command, price] of [["customers", 10], ["trending", 25], ["competitors", 30], ["formats", 20], ["search", 35]])
      assert.match(stdout, new RegExp(`${command}\\s+${price} credits`));
    for (const exit of [0, 1, 2, 3, 4, 5, 6, 7]) assert.match(stdout, new RegExp(`^  ${exit}  `, "m"));
    assert.match(stdout, /trendsfast login --background/);
    assert.match(stdout, /at least 10 minutes/);
    assert.match(stdout, /\(\+agent: <id>\)/);
  });

  it("gives every command its own help with every flag it accepts", async () => {
    for (const command of COMMANDS) {
      const { code, stdout } = await run([command, "--help"]);
      assert.equal(code, 0, command);
      assert.match(stdout, new RegExp(`^Usage: trendsfast ${command}`, "m"), command);
      assert.match(stdout, /Exit codes:/);
    }
    const { stdout } = await run(["customers", "--help"]);
    for (const flag of ["--max-credits", "--request-id", "--dry-run", "--json", "--format", "--output", "--lookback-hours", "--platforms", "--limit", "--context-id", "--yes"])
      assert.ok(stdout.includes(flag), flag);
    const login = await run(["login", "--help"]);
    for (const flag of ["--background", "--code-flow", "--code", "--paste", "--status", "--no-browser", "--base-url"]) assert.ok(login.stdout.includes(flag), flag);
  });

  it("refuses an unknown command or flag with exit 1 and points to help", async () => {
    const unknown = await run(["scrape"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /trendsfast --help/);
    const flag = await run(["customers", "--max-credit", "10"]);
    assert.equal(flag.code, 1);
    assert.match(flag.stderr, /Unknown option --max-credit .*trendsfast customers --help/);
    const extra = await run(["credits", "now"]);
    assert.equal(extra.code, 1);
  });

  it("prints its version", async () => {
    assert.match((await run(["--version"])).stdout, /^\d+\.\d+\.\d+\n$/);
  });
});

describe("attribution", () => {
  it("names the agent in the User-Agent, unless opted out", async () => {
    const { userAgent } = await import(new URL("../dist/agent-origin.js", import.meta.url).href);
    assert.match(userAgent({}), /^trendsfast-cli\/\d+\.\d+\.\d+$/);
    assert.match(userAgent({ CLAUDECODE: "1" }), /\(\+agent: claude-code\)$/);
    assert.match(userAgent({ CODEX_SANDBOX: "seatbelt", CLAUDECODE: "1" }), /\(\+agent: codex\)$/);
    assert.match(userAgent({ GEMINI_CLI: "1" }), /gemini-cli/);
    assert.doesNotMatch(userAgent({ CLAUDECODE: "1", TRENDSFAST_CLI_DISABLE_AGENT_ORIGIN: "1" }), /agent/);
  });
});
