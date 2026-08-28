import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillPath = new URL("../skills/trendsfast/SKILL.md", import.meta.url);
const skill = await readFile(skillPath, "utf8");
const normalized = skill.replace(/\s+/gu, " ");

const exactTools = [
  "trendsfast_project_context_get",
  "trendsfast_today_create",
  "trendsfast_today_status_get",
  "trendsfast_brief_latest_get",
  "trendsfast_brief_get",
  "trendsfast_creative_handoff_get",
  "trendsfast_sources_get",
];

function section(start, end) {
  const startIndex = skill.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section ${start}`);
  const endIndex =
    end === undefined
      ? skill.length
      : skill.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section boundary ${end}`);
  return skill.slice(startIndex, endIndex);
}

test("skill has valid, discriminating frontmatter", () => {
  assert.match(
    skill,
    /^---\nname: trendsfast\ndescription: .+\nmetadata:\n  version: "1\.0\.0"\n---\n/u,
  );
  assert.match(normalized, /project-scoped research/u);
  assert.match(normalized, /explicit founder confirmation/u);
});

test("skill names only the exact seven Remote MCP tools", () => {
  const referencedTools = [...skill.matchAll(/`(trendsfast_[a-z_]+)`/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual([...new Set(referencedTools)], exactTools);
});

test("read-before-create flow makes creation explicit and single-shot", () => {
  const readFlow = section("## Read before creating", "## Creation gate");
  const creationGate = section(
    "## Creation gate",
    "## Interpret the result honestly",
  );

  assert.match(
    readFlow,
    /Call `trendsfast_brief_latest_get` before considering a new scan/u,
  );
  assert.match(readFlow, /whether it is sufficient/u);
  assert.match(readFlow, /Never create automatically/u);
  assert.match(
    creationGate,
    /ask the founder immediately before starting the new billable scan/u,
  );
  assert.match(creationGate, /Continue only after explicit confirmation/u);
  assert.match(creationGate, /exactly one UUID v4 client-side/u);
  assert.match(creationGate, /Call `trendsfast_today_create` exactly once/u);
  assert.match(
    creationGate,
    /poll only through `trendsfast_today_status_get`/u,
  );
  assert.match(creationGate, /retry timing returned by each response/u);
  assert.match(creationGate, /Stop polling at `REVIEW_REQUIRED` or `READY`/u);
});

test("NO_CLEAR_TREND remains honest and cannot become a fake trend claim", () => {
  const interpretation = section(
    "## Interpret the result honestly",
    "## Present one Content Play",
  );

  assert.match(
    interpretation,
    /`CLEAR_TREND` means the returned evidence supports/u,
  );
  assert.match(interpretation, /`NO_CLEAR_TREND` is a valid, honest result/u);
  assert.match(
    interpretation,
    /Do not relabel it, rerun to force a different verdict/u,
  );
  assert.match(interpretation, /describe an evergreen fallback as a trend/u);
  assert.match(
    interpretation,
    /Preserve the meaning and provenance of all returned evidence and limitations/u,
  );
  assert.match(
    interpretation,
    /Do not omit limitations, strengthen claims, invent corroboration/u,
  );
});

test("result handling yields one complete play and preserves video evidence", () => {
  const presentation = section(
    "## Present one Content Play",
    "## Human-action boundary",
  );
  const requiredFields = [
    "scan ID and brief ID",
    "lifecycle and honest Trend Verdict",
    "platform and destination when applicable",
    "format",
    "hook",
    "complete content or script",
    "caption when applicable",
    "CTA",
    "evidence",
    "limitations",
  ];

  assert.match(presentation, /Present exactly one complete Content Play/u);
  for (const field of requiredFields)
    assert.ok(
      presentation.includes(field),
      `missing Content Play field: ${field}`,
    );
  assert.match(
    presentation,
    /When the Content Play is video, retrieve and present its creative handoff with `trendsfast_creative_handoff_get`/u,
  );
  assert.match(presentation, /When it is not video, do not invent a handoff/u);
  assert.match(presentation, /Never copy a named creator's expression/u);
});

test("skill forbids secret disclosure, cross-project access, and automatic actions", () => {
  const scope = section(
    "## Connection and project scope",
    "## Read before creating",
  );
  const boundary = section("## Human-action boundary");

  assert.match(scope, /Call `trendsfast_project_context_get` first/u);
  assert.match(scope, /Never call a tool from another project context/u);
  assert.match(scope, /Never expose the API key/u);
  assert.match(boundary, /Never approve, deliver, publish, or schedule/u);
  assert.match(boundary, /Present the Content Play for human review only/u);
  assert.match(boundary, /Never claim guaranteed virality/u);
});

test("skill contains no private implementation or embedded sensitive material", () => {
  const forbidden = [
    /\/(?:Users|private|home)\//iu,
    /\b(?:Supabase|Postgres|Vercel|Firecrawl)\b/iu,
    /\bprovider selection\b/iu,
    /\bscor(?:e|es|ing)\b/iu,
    /\bcustomer data\b/iu,
    /\bproduction keys?\b/iu,
    /\bfounder identity\b/iu,
    /\b(?:sk|tf)_(?:live|prod)_[A-Za-z0-9_-]+\b/u,
    /(?:\$|€|£)\s?\d/u,
  ];

  for (const pattern of forbidden) assert.doesNotMatch(skill, pattern);
});
