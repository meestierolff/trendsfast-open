/**
 * The compact view of a trends result: what an agent acts on, each free-text field
 * bounded, and the ids to come back by. It is the same view TrendsFast's MCP server sends
 * (`trends-mcp-compact-v3`); the private product repository checks that this function and
 * the server's return equal values for the same result. The full result stays available
 * from `result(id)`.
 */
import type {
  AskAnswer,
  CommunityProfile,
  Intelligence,
  IntelligenceItem,
  TrendsResult,
} from "./types.js";

export interface CompactItem {
  id: string;
  ring: "CORE" | "ADJACENT" | "GLOBAL";
  signal: string;
  measured_growth: string;
  freshness: string;
  platform: string;
  source: string;
  url: string | null;
  creator: string | null;
  title: string | null;
  excerpt: string | null;
  published_at: string | null;
  observed_at: string;
  /** The counts the platform showed, by metric name; one it did not show is absent. */
  metrics: Record<string, number>;
  community: string | null;
  question: string | null;
  problem: string | null;
  /** A video's opening line, from its transcript. */
  hook: string | null;
  format: string | null;
  relevance: { score: number; why: string };
  evidence_class: string | null;
  uses: string[];
  caution: string | null;
  topic_history: {
    state: string;
    since: string;
    peak_day: string;
    channels: number;
    velocity: number | null;
  } | null;
}

export interface CompactCommunity {
  community: string;
  url: string;
  status: string;
  weekly_active_users: number | null;
  self_promotion: { policy: string; rules: number[] };
  links: { policy: string; rules: number[] };
  ai_content: { policy: string; rules: number[] };
  promotion_venue: string | null;
  rules: { number: number; title: string }[];
  formats: { format: string; share: number }[];
  median_score: number | null;
  median_comments: number | null;
  winning_format: string | null;
  hook_pattern: string | null;
  avoid: string[];
  pinned: { title: string; url: string }[];
  play: string[];
}

export interface CompactAnswer {
  question: string;
  answer_status: string | null;
  answer: string;
  findings: Record<string, unknown>[];
  missing_inputs: string[];
  next_steps: string[];
}

export interface CompactResult {
  version: "trends-mcp-compact-v3";
  result_id: string;
  request_id: string;
  operation: string;
  generated_at: string;
  read_at: string;
  new_research: boolean;
  usage: { credits_charged: number; this_request_credits: number; replayed: boolean };
  next_cursor: string | null;
  context: { kind: string; context_id: string | null; revision: number | null } | null;
  window: { lookback_hours: number; observed_from: string; observed_to: string };
  brief: {
    headline: string;
    sections: { key: string; status: string; count: number; item_ids: string[]; note: string }[];
    coverage_gaps: { platform: string; note: string }[];
    next_steps: string[];
  } | null;
  items: CompactItem[];
  excluded_count: number;
  truncated: boolean;
  coverage: {
    source: string;
    platform: string;
    status: string;
    observation_count: number;
    last_observed_at: string | null;
  }[];
  communities: CompactCommunity[];
  ai_answers: {
    asked: number;
    answers: {
      platform: string;
      model: string;
      mentions_you: boolean;
      competitors_named: string[];
      names: string[];
      cited_domains: string[];
      excerpt: string | null;
    }[];
  } | null;
  /** An Ask's answer; null for every other operation. */
  answer: CompactAnswer | null;
  limitations: string[];
}

const ITEM_TEXT = { title: 180, excerpt: 200, question: 160, problem: 160, hook: 180 } as const;

/** Cuts a text to `most` characters, ending in "…" when it cut anything. */
export function clip(value: string | null | undefined, most: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`;
}
const clipped = (value: string, most: number): string => clip(value, most) ?? "";

function compactItem(item: IntelligenceItem): CompactItem {
  const observation = item.current_observation;
  const metrics = Object.fromEntries(
    observation.metrics.flatMap((metric) =>
      metric.value === null ? [] : [[metric.name, metric.value] as const],
    ),
  );
  return {
    id: item.id,
    ring: item.ring,
    signal: item.signal,
    measured_growth: item.measured_growth,
    freshness: item.freshness,
    platform: item.entity.platform,
    source: clipped(observation.source, 120),
    url: item.entity.original_url,
    creator: clip(item.entity.creator?.name, 180),
    title: clip(observation.title, ITEM_TEXT.title),
    excerpt: clip(observation.excerpt, ITEM_TEXT.excerpt),
    published_at: observation.published_at,
    observed_at: observation.observed_at,
    metrics,
    community: clip(observation.conversation?.community, 180),
    question: clip(observation.conversation?.question.value, ITEM_TEXT.question),
    problem: clip(observation.conversation?.problem.value, ITEM_TEXT.problem),
    hook: clip(observation.video?.hook.value, ITEM_TEXT.hook),
    format: clip(observation.video?.format.value, 100),
    relevance: { score: item.relevance.score, why: clipped(item.relevance.explanation, 100) },
    evidence_class: item.guidance?.evidence_class ?? null,
    uses: [...new Set((item.guidance?.uses ?? []).map((entry) => entry.use))].slice(0, 3),
    caution: clip(item.guidance?.caution, 100),
    topic_history: item.topic_history
      ? {
          state: item.topic_history.state,
          since: item.topic_history.since,
          peak_day: item.topic_history.peak_day,
          channels: item.topic_history.channels,
          velocity: item.topic_history.velocity,
        }
      : null,
  };
}

function compactCommunity(profile: CommunityProfile): CompactCommunity {
  const analysis = profile.format_analysis ?? null;
  return {
    community: profile.community,
    url: profile.url,
    status: profile.status,
    weekly_active_users: profile.weekly_active_users,
    self_promotion: profile.posting.self_promotion,
    links: profile.posting.links,
    ai_content: profile.posting.ai_content,
    promotion_venue: profile.posting.promotion_venue,
    rules: profile.rules
      .slice(0, 10)
      .map((rule) => ({ number: rule.number, title: clipped(rule.title, 120) })),
    formats: [...profile.culture.formats].sort((a, b) => b.share - a.share).slice(0, 3),
    median_score: profile.culture.median_score,
    median_comments: profile.culture.median_comments,
    winning_format: clip(analysis?.summary, 300),
    hook_pattern: clip(analysis?.hook, 200),
    avoid: (analysis?.avoid ?? []).slice(0, 3).map((entry) => clipped(entry, 200)),
    pinned: (profile.community_posts ?? [])
      .slice(0, 3)
      .map((post) => ({ title: clipped(post.title, 160), url: post.url })),
    play: profile.play.slice(0, 4).map((entry) => clipped(entry, 300)),
  };
}

function compactAnswer(ask: AskAnswer): CompactAnswer {
  return {
    question: clipped(ask.question, 1000),
    answer_status: ask.answer_status ?? null,
    answer: clipped(ask.answer, 1500),
    findings: (ask.findings ?? []).map(({ evidence_ids: _evidence, ...finding }) => ({
      ...finding,
      title: clipped(finding.title, 240),
      statement: clipped(finding.statement, 400),
    })),
    missing_inputs: (ask.missing_inputs ?? []).map((entry) => clipped(entry, 300)),
    next_steps: (ask.next_steps ?? []).map((entry) => clipped(entry, 300)),
  };
}

/** The intelligence inside a result, whether it is an Ask's answer or a plain read. */
export function resultIntelligence(result: TrendsResult): Intelligence {
  return result.data.version === "trend-ask-v3" ? result.data.intelligence : result.data;
}

/** The compact view of one result. Pure. */
export function compactResult(response: TrendsResult): CompactResult {
  const data = response.data;
  const ask = data.version === "trend-ask-v3" ? data : null;
  const intelligence = resultIntelligence(response);
  // An Ask's findings are its answer, so it sends the items they cite rather than the page.
  const cited = new Set((ask?.findings ?? []).map((finding) => finding.item_id));
  const items =
    ask && cited.size
      ? intelligence.items.filter((item) => cited.has(item.id))
      : ask
        ? intelligence.items.slice(0, 10)
        : intelligence.items;
  const brief = intelligence.brief ?? null;
  return {
    version: "trends-mcp-compact-v3",
    result_id: response.result_id,
    request_id: response.request_id,
    operation: response.operation,
    generated_at: response.generated_at,
    read_at: response.read_at,
    new_research: response.new_research,
    usage: {
      credits_charged: response.usage.credits_charged,
      this_request_credits: response.usage.this_request_credits,
      replayed: response.usage.replayed,
    },
    next_cursor: response.next_cursor,
    context: intelligence.context
      ? {
          kind: intelligence.context.kind,
          context_id: intelligence.context.context_id,
          revision: intelligence.context.revision,
        }
      : null,
    window: intelligence.classification_window,
    brief: brief
      ? {
          headline: brief.headline,
          sections: brief.sections.map((section) => ({
            key: section.key,
            status: section.status,
            count: section.count,
            item_ids: section.item_ids,
            note: clipped(section.note, 300),
          })),
          coverage_gaps: brief.coverage_gaps
            .slice(0, 10)
            .map((gap) => ({ platform: gap.platform, note: clipped(gap.note, 200) })),
          next_steps: brief.next_steps.slice(0, 5).map((step) => clipped(step, 300)),
        }
      : null,
    items: items.map(compactItem),
    excluded_count: intelligence.excluded_count,
    truncated: intelligence.truncated,
    coverage: intelligence.coverage.slice(0, 40).map((entry) => ({
      source: clipped(entry.source, 200),
      platform: entry.platform,
      status: entry.status,
      observation_count: entry.observation_count,
      last_observed_at: entry.last_observed_at,
    })),
    communities: (intelligence.communities ?? []).map(compactCommunity),
    ai_answers: intelligence.ai_answers
      ? {
          asked: intelligence.ai_answers.asked,
          answers: intelligence.ai_answers.answers.map((answer) => ({
            platform: answer.platform,
            model: clipped(answer.model, 100),
            mentions_you: answer.mentions_you,
            competitors_named: answer.competitors_named.slice(0, 8),
            names: answer.names.slice(0, 10),
            cited_domains: answer.cited_domains.slice(0, 8),
            excerpt: clip(answer.excerpt, 400),
          })),
        }
      : null,
    answer: ask ? compactAnswer(ask) : null,
    limitations: [...(ask?.limitations ?? []), ...intelligence.limitations]
      .slice(0, 3)
      .map((entry) => clipped(entry, 200)),
  };
}
