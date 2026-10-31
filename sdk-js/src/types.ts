/**
 * The shapes TrendsFast's V3 REST API returns, written by hand from
 * https://trendsfast.com/v3/openapi.json. Fields an agent rarely reads are typed loosely;
 * the full contract stays the authority.
 */
import type {
  Category,
  ContentType,
  DiscoverChannel,
  DiscoverScope,
  EvidenceQuality,
  Operation,
  Platform,
  ProductId,
  Signal,
} from "./catalog.js";

/** The filters every index read accepts (`TrendIndexQueryV3`). */
export interface TrendFilters {
  platforms?: Platform[];
  content_types?: ContentType[];
  categories?: Category[];
  signals?: Signal[];
  evidence_quality?: EvidenceQuality[];
  /** Two-letter country code the source asserted, such as "US". */
  country?: string;
  region?: string;
  /** Two-letter market whose chart or feed the observation came from. */
  observed_market?: string;
  /** Language such as "en" or "en-US". */
  language?: string;
  /** ISO date-time; the window's start. */
  observed_from?: string;
  /** ISO date-time; the window's end. */
  observed_to?: string;
  /** How far back to read, 1 to 720 hours. The server's default is 72. */
  lookback_hours?: number;
  history_days?: number;
  compare_to?: string;
  /** Items per page, 1 to 100. The server's default is 20. */
  limit?: number;
}

/** A niche described in words, read from the index without collecting (`input.niche`). */
export interface TemporaryNiche {
  description: string;
  url?: string;
  topics?: string[];
  problems?: string[];
  audiences?: string[];
  exclusions?: string[];
  capabilities?: string[];
  jobs?: string[];
  industry?: string[];
  product_categories?: string[];
  customer_interests?: string[];
  competitors?: string[];
  adjacent_categories?: string[];
  market?: string;
  language?: string;
  platforms?: Platform[];
  communities?: string[];
  competitor_handles?: string[];
  competitor_domains?: string[];
  keywords?: string[];
}

/** What every paid call accepts besides its input. */
export interface CallOptions {
  /** A UUID you keep until you have the outcome. Made for you when omitted. A retry of the
   * same call must reuse it; a new question gets a new one. */
  request_id?: string;
  /** The most this call may cost. Defaults to the call's tariff. */
  max_credits?: number;
}

export interface ProductOptions extends TrendFilters, CallOptions {
  /** The brand's confirmed context. Read for free from `context()` when omitted. */
  context_id?: string;
  include_adjacent?: boolean;
  include_global?: boolean;
}

export type GlobalOptions = TrendFilters & CallOptions;

export interface NicheOptions extends TrendFilters, CallOptions {
  /** Rank against this confirmed context instead of a typed niche. */
  context_id?: string;
  include_adjacent?: boolean;
  include_global?: boolean;
}

export interface AskOptions extends TrendFilters, CallOptions {
  context_id?: string;
  niche?: TemporaryNiche;
  /** Rank against the brand's confirmed context, read for free first. */
  brand?: boolean;
  include_adjacent?: boolean;
  include_global?: boolean;
}

export interface DiscoverOptions extends AskOptions {
  scope?: DiscoverScope[];
  channels?: DiscoverChannel[];
}

export interface NicheContextField {
  field: string;
  value: string;
  basis: "OWNER_CONFIRMED" | "WEBSITE_OBSERVED" | "USER_ASSERTED" | "INFERRED";
  evidence_ids: string[];
}

export interface NicheContext {
  kind: "CONFIRMED_CONTEXT" | "TEMPORARY_INPUT";
  context_id: string | null;
  revision: number | null;
  fields: NicheContextField[];
}

export interface ContextResponse {
  version: "trend-context-v3";
  context: NicheContext | null;
}

export interface CreditLot {
  id: string;
  kind: "FREE" | "MONTHLY" | "PREPAID";
  total: number;
  consumed: number;
  reserved: number;
  revoked: number;
  available: number;
  expiresAt: string | null;
}

export interface WalletResponse {
  version: "credit-wallet-v3";
  accountId: string;
  available: number;
  free: number;
  monthly: number;
  prepaid: number;
  reserved: number;
  consumed: number;
  debt: number;
  paused: boolean;
  lots: CreditLot[];
}

export interface QuoteResponse {
  version: "trends-credit-quote-v3";
  operation: Operation;
  credits: number;
  max_credits: number;
  catalog_version: string;
  new_research: boolean;
  available: boolean;
}

export interface HistoryEntry {
  result_id: string;
  request_id: string;
  operation: Operation;
  product?: ProductId;
  created_at: string;
  state: "CONSUMED";
  charged_credits: number;
}

export interface HistoryResponse {
  version: "trends-history-v3";
  results: HistoryEntry[];
  next_cursor: string | null;
}

export interface MetricSnapshot {
  name: string;
  value: number | null;
  unit: "COUNT" | "INDEX" | "MODELED_MONTHLY_COUNT" | "PERCENT";
  semantics: string;
  definition: string;
  scope: string;
  observed_at: string;
  period_start: string | null;
  period_end: string | null;
  freshness_basis?: string;
}

export interface GroundedText {
  value: string | null;
  basis: string;
  evidence_ids: string[];
}

export interface Observation {
  version: "trend-index-observation-v3";
  id: string;
  entity: Entity;
  source: string;
  origin: string;
  content_type: ContentType;
  title: string | null;
  excerpt: string | null;
  published_at: string | null;
  observed_at: string;
  expires_at: string;
  language: string | null;
  country: string | null;
  region: string | null;
  categories: Category[];
  metrics: MetricSnapshot[];
  video: {
    duration_seconds: number | null;
    format: GroundedText;
    hook: GroundedText;
    visual_narrative: GroundedText;
    media_analysis: Record<string, unknown>;
  } | null;
  conversation: {
    community: string | null;
    question: GroundedText;
    problem: GroundedText;
    [key: string]: unknown;
  } | null;
  search: Record<string, unknown> | null;
  evidence_quality: EvidenceQuality;
  limitations: string[];
  [key: string]: unknown;
}

export interface Entity {
  id: string;
  platform: Platform;
  native_id: string;
  original_url: string | null;
  creator: { native_id?: string; name: string | null; url?: string | null } | null;
}

export interface TopicHistory {
  topic_key: string;
  state: "EMERGING" | "RISING" | "PEAKING" | "DECLINING" | "EVERGREEN";
  since: string;
  first_seen: string;
  peak_day: string;
  channels: number;
  velocity: number | null;
  as_of: string;
  method_version: string;
  series_method_version: string;
}

export interface IntelligenceItem {
  id: string;
  cluster_id: string;
  entity: Entity;
  content_type: ContentType;
  current_observation: Observation;
  observation_ids: string[];
  signal: Signal;
  signal_basis: string;
  measured_growth: "INCREASING_OBSERVED" | "DECREASING_OBSERVED" | "UNCHANGED_OBSERVED" | "NOT_COMPARABLE";
  growth: unknown[];
  virality: string;
  ring: "CORE" | "ADJACENT" | "GLOBAL";
  relevance: {
    basis: string;
    score: number;
    matched_fields: unknown[];
    matched_categories: unknown[];
    product_fit: string;
    explanation: string;
  };
  freshness: string;
  limitations: string[];
  guidance?: {
    evidence_class: string;
    uses: { use: string; channels: string[]; note: string }[];
    caution: string;
  };
  topic_history?: TopicHistory | null;
  [key: string]: unknown;
}

export interface Coverage {
  source: string;
  platform: Platform;
  status: "OBSERVATIONS_AVAILABLE" | "COLLECTED_EMPTY" | "OUTCOME_UNKNOWN" | "NOT_COLLECTED" | "RIGHTS_UNAVAILABLE";
  last_observed_at: string | null;
  observation_count: number;
  limitations: string[];
}

export interface Brief {
  version: "trend-brief-v3";
  headline: string;
  sections: {
    key: string;
    status: "AVAILABLE" | "EMPTY" | "NOT_COLLECTED" | "NEEDS_CONTEXT";
    count: number;
    item_ids: string[];
    note: string;
  }[];
  sources: { source: string; platform: Platform; items: number; markets: string[] }[];
  coverage_gaps: { platform: Platform; note: string }[];
  next_steps: string[];
}

export interface CommunityPolicy {
  policy: "ALLOWED" | "RESTRICTED" | "NOT_ALLOWED" | "UNKNOWN";
  rules: number[];
}

export interface CommunityProfile {
  version: "community-profile-v3";
  platform: "REDDIT";
  community: string;
  url: string;
  status: "PROFILED" | "NOT_FOUND" | "UNAVAILABLE";
  weekly_active_users: number | null;
  rules: { number: number; title: string; text: string; source: string }[];
  posting: {
    self_promotion: CommunityPolicy;
    links: CommunityPolicy;
    ai_content: CommunityPolicy;
    promotion_venue: string | null;
    [key: string]: unknown;
  };
  culture: {
    formats: { format: string; share: number }[];
    median_score: number | null;
    median_comments: number | null;
    [key: string]: unknown;
  };
  community_posts?: { title: string; url: string; text: string; pinned: boolean; posted_at: string | null }[];
  format_analysis?: { summary: string; hook: string; avoid: string[]; [key: string]: unknown } | null;
  play: string[];
  limitations: string[];
  [key: string]: unknown;
}

export interface AiAnswer {
  platform: "CHATGPT" | "PERPLEXITY" | "GEMINI" | "CLAUDE";
  model: string;
  category: Category;
  question: string;
  answered_at: string;
  mentions_you: boolean;
  competitors_named: string[];
  names: string[];
  cited_domains: string[];
  excerpt: string | null;
}

export interface Intelligence {
  version: "trend-intelligence-v3";
  snapshot_id: string;
  as_of: string;
  read_at: string;
  classification_as_of: string;
  classification_window: { lookback_hours: number; observed_from: string; observed_to: string };
  context: NicheContext | null;
  items: IntelligenceItem[];
  coverage: Coverage[];
  excluded_count: number;
  truncated: boolean;
  history_status?: "OBSERVATIONS_AVAILABLE" | "NOT_OBSERVED";
  new_research: boolean;
  limitations: string[];
  brief?: Brief;
  ai_answers?: { provider: string; asked: number; answers: AiAnswer[]; limitations: string[] };
  communities?: CommunityProfile[];
}

export interface AskFinding {
  kind: string;
  item_id: string;
  title: string;
  statement: string;
  platform: Platform;
  source: string;
  url: string | null;
  metrics: string | null;
  published_at: string | null;
  ring: "CORE" | "ADJACENT" | "GLOBAL";
  evidence_ids: string[];
}

export interface AskAnswer {
  version: "trend-ask-v3";
  question: string;
  plan: Record<string, unknown>;
  intelligence: Intelligence;
  claims: { text: string; evidence_ids: string[] }[];
  answer: string;
  limitations: string[];
  answer_status?: "ANSWERED" | "PARTIAL" | "INSUFFICIENT_EVIDENCE" | "NEEDS_CONTEXT" | "NOT_COLLECTED";
  findings?: AskFinding[];
  next_steps?: string[];
  missing_inputs?: string[];
}

/** One saved result: what every paid call, reread and recovery returns. */
export interface TrendsResult {
  version: "trends-api-v3";
  result_id: string;
  request_id: string;
  operation: Operation;
  generated_at: string;
  read_at: string;
  new_research: boolean;
  data: Intelligence | AskAnswer;
  usage: {
    credits_charged: number;
    read_charge: 0;
    this_request_credits: number;
    catalog_version: string;
    replayed: boolean;
  };
  next_cursor: string | null;
}
