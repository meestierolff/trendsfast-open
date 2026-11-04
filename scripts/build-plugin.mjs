#!/usr/bin/env node
// Builds the MCP-only references of plugins/trendsfast from the kit's own, so a change to what a
// result means reaches both skills. The kit's skill works through the CLI, which a plugin must
// not ask for: Claude's directory, Cursor's marketplace and xAI's catalog review it as code that
// reaches only its declared MCP server. Every replacement below must match, and nothing of the
// CLI may survive, so a reworded source fails here instead of shipping half-translated.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(KIT, "skills/trendsfast/references");
const TARGET = join(KIT, "plugins/trendsfast/skills/trendsfast/references");

const RUN =
  /Over MCP, `trendsfast_niche_trends` with these arguments \(REST: [^)]*\[rest\.md\]\(rest\.md\)\):/u;
const RUN_MCP = "`trendsfast_niche_trends` with these arguments:";
const CONTEXT = [
  "`trendsfast context` (free)",
  "`trendsfast_project_context` (free)",
];
const BALANCE = [
  "`trendsfast credits` (free).",
  "`trendsfast_credit_balance` (free).",
];

/** What differs per file, as [from, to]. Each `from` must be present. */
const EDITS = {
  "customers.md": [
    [RUN, RUN_MCP],
    [
      "`--lookback-hours`,\n`--platforms REDDIT,X` and `--limit` narrow it when they do.",
      "`lookback_hours`,\n`platforms` and `limit` in `input` narrow it when they do.",
    ],
    [/- In the saved file:\n {2}`jq [^\n]*\n/u, ""],
  ],
  "trending.md": [
    [RUN, RUN_MCP],
    [
      "`trendsfast global --max-credits 1` is cheaper.",
      "`trendsfast_global_trends` (1 credit) is cheaper.",
    ],
    ["a short video's `view_benchmark` band", "a short video's `view_band`"],
    [
      "and its `engagement` rate (over 5%",
      "and its `engagement_rate` (over 5%",
    ],
  ],
  "formats.md": [
    [RUN, RUN_MCP],
    [
      /- `formats`, in the full result[\s\S]*?The compact view carries each item's `format`, so it can be tallied there\.\n/u,
      "- Tally each item's `format` to compare them, and say how many videos and accounts a format\n  rests on. The per-format table is in the full result on the REST API.\n",
    ],
  ],
  "competitors.md": [
    [RUN, RUN_MCP],
    [
      "`trendsfast context` (free) names",
      "`trendsfast_project_context` (free) names",
    ],
    [
      "`breakout` (over 3×), `percentile`, and the baseline's",
      "`breakout` (over 3×), and the baseline's",
    ],
    [
      "Lead with the breakouts; quote `basis`. A post",
      "Lead with the breakouts. A post",
    ],
    [
      /- Where the platform sent the account's follower count: `performance\.creator`[\s\S]*?tier, as below\)\.\n/u,
      "- Where the platform sent the account's follower count: each post's `performance.virality`, its\n  Virality Score and tier.\n",
    ],
  ],
  "search.md": [[RUN, RUN_MCP]],
  "content-plan.md": [
    CONTEXT,
    BALANCE,
    [
      /They can run in parallel, each with its own request ID\. On exit 6[\s\S]*?`product` `customers`, `niche` and `formats`\./u,
      "Three `trendsfast_niche_trends` calls, with `product` `customers`, `niche` and `formats`. They\ncan run in parallel, each with its own request ID. On `REQUEST_OUTCOME_UNCONFIRMED` read it back\nwith `trendsfast_read_result` and keep going with what you have.",
    ],
    [
      "`trendsfast result <id>`\n   rereads them",
      "`trendsfast_read_result`\n   rereads them",
    ],
  ],
  "market-brief.md": [
    CONTEXT,
    BALANCE,
    [
      'Customers; add `trendsfast ask "<the decision>" --brand` (5) if it fits',
      "Customers; add `trendsfast_ask_trends` with the decision (5) if it fits",
    ],
    [
      '`trendsfast ask "<the decision>" --brand` (5) or `trendsfast niche --brand` (3)',
      "`trendsfast_ask_trends` with the decision (5) or `trendsfast_niche_trends` without a product (3)",
    ],
    [
      /They can run in parallel, each with its own request ID\. On exit 6[\s\S]*?`product` `customers`, `competitors` and `search`\./u,
      "`trendsfast_niche_trends` calls, with `product` `customers`, `competitors` and `search`. They can\nrun in parallel, each with its own request ID. On `REQUEST_OUTCOME_UNCONFIRMED` read it back with\n`trendsfast_read_result`; never re-run under a new ID.",
    ],
  ],
  "errors.md": [
    [
      "The CLI exits with one code per kind of failure. Over MCP and REST the same code arrives as\n`error` in the response.",
      "A failed call names its code as `error` in the response.",
    ],
    [
      "| Exit | Code | What to do |\n| --- | --- | --- |",
      "| Code | What to do |\n| --- | --- |",
    ],
    [/^\| \d \| /gmu, "| "],
    ["`PRODUCT_REQUIRES_CONTEXT`, usage |", "`PRODUCT_REQUIRES_CONTEXT` |"],
    ["or a wrong flag; nothing", "or a wrong argument; nothing"],
    [
      "Not signed in or the key is refused.",
      "Not signed in, or the connection was refused.",
    ],
    [
      "Read `trendsfast <command> --help`; for a typed niche use `trendsfast niche`.",
      "Check the arguments against the tool's schema; a typed niche names no product.",
    ],
    [
      "Run `trendsfast whoami` once, report, stop.",
      "Ask the user to connect this app again, report, stop.",
    ],
    ["then run the same command again.", "then make the same call again."],
    [
      "run `trendsfast request <id>` later (MCP: `trendsfast_read_result` with the `request_id`), never the call under a new ID.",
      "call `trendsfast_read_result` with the `request_id` later, never the call under a new ID.",
    ],
    ["| network or server |", "| Network or server failure |"],
    [
      "Exits 2 and 3 are terminal for the task:",
      "`AUTH_REQUIRED`, `INSUFFICIENT_SCOPE`, `INSUFFICIENT_CREDITS` and `CREDIT_QUOTE_EXCEEDS_LIMIT`\nend the task:",
    ],
  ],
};

/** The CLI, REST and shell, which an MCP-only skill must never tell an agent to use. */
const FORBIDDEN =
  /`trendsfast [a-z<]|--max-credits|--brand|--platforms|--lookback|\bnpx\b|\bcurl\b|\bjq\b|\bbash\b|Bash\(|\bexit \d|\bExit\b|rest\.md|setup\.md|\s-o\s/u;

export function buildPluginReference(name, source) {
  let text = source.replace(/```bash\n[\s\S]*?```\n\n?/gu, "");
  for (const [from, to] of EDITS[name]) {
    const matched =
      typeof from === "string" ? text.includes(from) : text.search(from) !== -1;
    if (!matched)
      throw new Error(`${name}: the source no longer holds: ${from}`);
    text =
      typeof from === "string"
        ? text.replaceAll(from, to)
        : text.replace(from, to);
  }
  const left = FORBIDDEN.exec(text);
  if (left)
    throw new Error(`${name}: CLI text survived: ${JSON.stringify(left[0])}`);
  return text;
}

export function buildPluginReferences() {
  return Object.fromEntries(
    Object.keys(EDITS).map((name) => [
      name,
      buildPluginReference(name, readFileSync(join(SOURCE, name), "utf8")),
    ]),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(TARGET, { recursive: true });
  for (const [name, text] of Object.entries(buildPluginReferences()))
    writeFileSync(join(TARGET, name), text);
}
