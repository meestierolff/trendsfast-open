/** The readable summaries the CLI prints on stdout: small on purpose, one fact per line,
 * every item with its source link, so an agent can cite it without reading the full
 * response. The full response is one `-o` or `--format full` away. */
import { creditsLabel, findProduct } from "./sdk/catalog.js";
import type { CompactItem, CompactResult } from "./sdk/compact.js";
import type { ContextResponse, HistoryResponse, QuoteResponse, WalletResponse } from "./sdk/types.js";

export function utc(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** One measured signal with its unit, as the platform reported it. */
export function metricText(name: string, value: number): string {
  switch (name) {
    case "relative_interest":
      return `relative interest ${number(value)}/100`;
    case "estimated_monthly_demand":
      return `~${number(value)} searches/month (modeled)`;
    case "rising_percent":
      return `rising ${value >= 0 ? "+" : ""}${number(value)}%`;
    default:
      return `${name.replace(/_/g, " ")} ${number(value)}`;
  }
}

function itemLines(item: CompactItem, index: number): string[] {
  const lines = [`${index + 1}. [${item.platform}] ${item.title ?? item.excerpt ?? "(untitled)"}`];
  const meta = [
    item.community,
    item.creator,
    `observed ${utc(item.observed_at)}`,
    ...Object.entries(item.metrics).map(([name, value]) => metricText(name, value)),
  ].filter(Boolean);
  if (item.topic_history)
    meta.push(
      `topic ${item.topic_history.state} since ${item.topic_history.since} on ${item.topic_history.channels} channel${item.topic_history.channels === 1 ? "" : "s"}`,
    );
  lines.push(`   ${meta.join(" · ")}`);
  const detail = [
    item.problem ? `problem: ${item.problem}` : null,
    item.question ? `question: ${item.question}` : null,
    item.hook ? `hook: "${item.hook}"` : null,
    item.format ? `format: ${item.format}` : null,
  ].filter(Boolean);
  if (detail.length) lines.push(`   ${detail.join(" · ")}`);
  if (item.url) lines.push(`   ${item.url}`);
  return lines;
}

const policy = (label: string, entry: { policy: string; rules: number[] }) =>
  `${label} ${entry.policy}${entry.rules.length ? ` (rule${entry.rules.length > 1 ? "s" : ""} ${entry.rules.join(", ")})` : ""}`;

/** A label for what produced a result: the product's name, or the operation. */
export function resultLabel(operation: string, productId?: string): string {
  const product = productId ? findProduct(productId) : undefined;
  return product ? `${product.name} (${product.command})` : operation;
}

export function formatResult(compact: CompactResult, label: string): string {
  const lines: string[] = [];
  const window = compact.window;
  lines.push(
    `${label} · ${compact.items.length} item${compact.items.length === 1 ? "" : "s"} · window ${utc(window.observed_from)} → ${utc(window.observed_to)} (${window.lookback_hours}h) · fresh research: ${compact.new_research ? "yes" : "no"}`,
  );
  if (compact.brief?.headline) lines.push(`Brief: ${compact.brief.headline}`);

  if (compact.answer) {
    lines.push("", `Answer (${compact.answer.answer_status ?? "UNRATED"}): ${compact.answer.answer}`);
    if (compact.answer.findings.length) {
      lines.push("Findings:");
      compact.answer.findings.forEach((finding, index) => {
        const f = finding as Record<string, string | null>;
        lines.push(
          `${index + 1}. ${f.kind}: ${f.title} — ${f.statement} [${f.platform}]${f.metrics ? ` (${f.metrics})` : ""}${f.url ? ` ${f.url}` : ""}`,
        );
      });
    }
    if (compact.answer.missing_inputs.length) lines.push(`Missing: ${compact.answer.missing_inputs.join("; ")}`);
    if (compact.answer.next_steps.length) lines.push(`Next steps: ${compact.answer.next_steps.join("; ")}`);
    if (compact.items.length) lines.push("", "Cited items:");
  } else lines.push("");

  if (!compact.items.length && !compact.answer)
    lines.push("No items matched. An empty result costs 0 credits; coverage below says what was read.");
  compact.items.forEach((item, index) => lines.push(...itemLines(item, index)));

  if (compact.communities.length) {
    lines.push("", "Communities (read the rules before drafting; silence in the rules is not permission):");
    for (const community of compact.communities) {
      const name = /^r\//.test(community.community) ? community.community : `r/${community.community}`;
      if (community.status !== "PROFILED") {
        lines.push(`- ${name}: ${community.status}`);
        continue;
      }
      lines.push(
        `- ${name}: ${policy("self-promotion", community.self_promotion)}, ${policy("links", community.links)}, ${policy("AI-written posts", community.ai_content)}${community.promotion_venue ? `; promotion only in ${community.promotion_venue}` : ""}`,
      );
      if (community.winning_format) lines.push(`  wins: ${community.winning_format}`);
      if (community.avoid.length) lines.push(`  avoid: ${community.avoid.join("; ")}`);
      for (const play of community.play.slice(0, 2)) lines.push(`  play: ${play}`);
      lines.push(`  ${community.url}`);
    }
  }

  if (compact.ai_answers) {
    lines.push("", `AI answers (${compact.ai_answers.asked} asked):`);
    for (const answer of compact.ai_answers.answers)
      lines.push(
        `- ${answer.platform}: ${answer.mentions_you ? "names you" : "does not name you"}${answer.competitors_named.length ? `; competitors named: ${answer.competitors_named.join(", ")}` : ""}${answer.names.length ? `; names: ${answer.names.join(", ")}` : ""}${answer.cited_domains.length ? `; cites: ${answer.cited_domains.join(", ")}` : ""}`,
      );
  }

  if (compact.coverage.length) {
    const status: Record<string, string> = {
      OBSERVATIONS_AVAILABLE: "observed",
      COLLECTED_EMPTY: "collected, empty",
      OUTCOME_UNKNOWN: "outcome unknown",
      NOT_COLLECTED: "not collected",
      RIGHTS_UNAVAILABLE: "not permitted",
    };
    lines.push(
      "",
      `Coverage: ${compact.coverage
        .map((entry) => `${entry.platform} ${status[entry.status] ?? entry.status}${entry.observation_count ? ` (${entry.observation_count})` : ""}`)
        .join(" · ")}`,
    );
  }
  if (compact.brief?.coverage_gaps.length)
    lines.push(`Gaps: ${compact.brief.coverage_gaps.map((gap) => `${gap.platform}: ${gap.note}`).join("; ")}`);
  if (compact.brief?.next_steps.length) lines.push(`Next steps: ${compact.brief.next_steps.join("; ")}`);
  if (compact.next_cursor) lines.push(`Next page: trendsfast result ${compact.result_id} --cursor ${compact.next_cursor}`);
  return `${lines.join("\n")}\n`;
}

export function formatContext(response: ContextResponse): string {
  const context = response.context;
  if (!context)
    return "No confirmed brand context yet. Product commands need one: add and confirm your brand at https://trendsfast.com/dashboard. `trendsfast niche \"<description>\"` reads a niche you describe without one.\n";
  const lines = [
    `Brand context ${context.context_id ?? "(none)"} · revision ${context.revision ?? "-"} · ${context.kind}`,
  ];
  const grouped = new Map<string, string[]>();
  for (const field of context.fields) grouped.set(field.field, [...(grouped.get(field.field) ?? []), field.value]);
  for (const [field, values] of grouped) {
    const shown = values.slice(0, 12).map((value) => (value.length > 200 ? `${value.slice(0, 199)}…` : value));
    lines.push(`${field}: ${shown.join("; ")}${values.length > 12 ? ` (+${values.length - 12} more)` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatWallet(wallet: WalletResponse): string {
  const lines = [
    `Available: ${creditsLabel(wallet.available)} (free ${wallet.free} · monthly ${wallet.monthly} · prepaid ${wallet.prepaid}) · reserved ${wallet.reserved}`,
  ];
  if (wallet.paused) lines.push("The account is paused: paid calls are refused until it is resumed.");
  if (wallet.debt) lines.push(`Debt: ${wallet.debt} credits.`);
  for (const lot of wallet.lots.filter((entry) => entry.available > 0 && entry.expiresAt))
    lines.push(`${lot.available} ${lot.kind.toLowerCase()} credits expire ${utc(lot.expiresAt)}`);
  lines.push("Plans and packs: https://trendsfast.com/pricing");
  return `${lines.join("\n")}\n`;
}

export function formatQuote(quote: QuoteResponse, label: string): string {
  return `${label}: ${creditsLabel(quote.credits)} (max_credits ${quote.max_credits}; catalog ${quote.catalog_version})\n`;
}

export function formatHistory(history: HistoryResponse): string {
  if (!history.results.length) return "No saved results yet.\n";
  const lines = history.results.map((entry) => {
    const label = entry.product ? (findProduct(entry.product)?.command ?? entry.product) : entry.operation;
    return `${utc(entry.created_at)}  ${label.padEnd(11)} ${creditsLabel(entry.charged_credits).padEnd(10)} result ${entry.result_id}  request ${entry.request_id}`;
  });
  if (history.next_cursor) lines.push(`Next page: trendsfast history --cursor ${history.next_cursor}`);
  return `${lines.join("\n")}\n`;
}
