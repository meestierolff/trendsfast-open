/**
 * What TrendsFast sells, where each call lives and what it costs.
 *
 * The routes and limits follow https://trendsfast.com/v3/openapi.json (contract
 * `trends-api-v3`). The prices are the public tariffs; the free quote
 * (`GET /v3/trends/quote`) is the authority at run time, and TrendsFast never charges more
 * than the `max_credits` a call carries. The private product repository checks every value
 * here against the server's own tariffs, schemas and OpenAPI document, so a change there
 * fails before this package can drift.
 */

export const DEFAULT_BASE_URL = "https://trendsfast.com";

/** Where people sign in, add their brand and create or revoke keys. */
export const DASHBOARD_URL = "https://trendsfast.com/dashboard";
export const API_KEYS_URL = "https://trendsfast.com/dashboard/api-keys";
export const PRICING_URL = "https://trendsfast.com/pricing";

/** The environment variable a key is read from before the stored CLI credentials. */
export const API_KEY_ENV = "TRENDSFAST_API_KEY";
export const BASE_URL_ENV = "TRENDSFAST_BASE_URL";

/** The highest `max_credits` the API accepts on one call. */
export const MAX_CREDITS_CEILING = 1000;

/** A paid call may take the server's full 120 seconds; this waits a little longer so a slow
 * product run is answered rather than cut off here with an unknown outcome. */
export const PAID_TIMEOUT_MS = 150_000;
export const READ_TIMEOUT_MS = 30_000;

export type Operation = "global" | "niche" | "ask" | "discover";
export const OPERATIONS: readonly Operation[] = ["global", "niche", "ask", "discover"];

export type ProductId = "customers" | "niche" | "competitors" | "formats" | "search";

export interface Product {
  /** The API's product id. `niche` is sold as Trending. */
  readonly id: ProductId;
  /** The public product name. */
  readonly name: string;
  /** The CLI command and SDK method that run it. */
  readonly command: "customers" | "trending" | "competitors" | "formats" | "search";
  /** What one call costs, in credits. */
  readonly credits: number;
  /** The question it answers, in a founder's words. */
  readonly question: string;
  /** The sources it collects fresh when it is called. */
  readonly reads: string;
}

/** The five products, in the order a founder needs them. Each is one
 * `POST /v3/trends/niche` call with `input.product` on the brand's confirmed context. */
export const PRODUCTS: readonly Product[] = [
  {
    id: "customers",
    name: "Customers",
    command: "customers",
    credits: 10,
    question: "What are my customers stuck on?",
    reads: "Reddit, X, Hacker News and GitHub",
  },
  {
    id: "niche",
    name: "Trending",
    command: "trending",
    credits: 25,
    question: "What's trending in my niche, and next door?",
    reads: "TikTok, YouTube, Instagram, Facebook, X, Reddit, Hacker News and Google Trends",
  },
  {
    id: "competitors",
    name: "Competitors",
    command: "competitors",
    credits: 30,
    question: "What are my competitors doing?",
    reads: "X, TikTok, Instagram and YouTube",
  },
  {
    id: "formats",
    name: "Formats",
    command: "formats",
    credits: 20,
    question: "What videos work in my niche?",
    reads: "TikTok, YouTube, Instagram and Facebook",
  },
  {
    id: "search",
    name: "Search",
    command: "search",
    credits: 35,
    question: "What do people search for, and what do AI assistants answer?",
    reads: "Google Trends, ChatGPT, Claude, Gemini and Perplexity",
  },
];

/** What a read of saved observations costs, by operation. A niche read here names no
 * product: it ranks the index against a brand or a typed niche and collects nothing. */
export const READ_CREDITS: Readonly<Record<Operation, number>> = {
  global: 1,
  niche: 3,
  ask: 5,
  discover: 5,
};

export const PATHS = {
  global: "/v3/trends/global",
  niche: "/v3/trends/niche",
  ask: "/v3/trends/ask",
  discover: "/v3/trends/discover",
  result: "/v3/trends/results/{id}",
  request: "/v3/trends/requests/{id}",
  wallet: "/v3/trends/wallet",
  history: "/v3/trends/history",
  quote: "/v3/trends/quote",
  context: "/v3/trends/context",
} as const;

export const PLATFORMS = [
  "TIKTOK",
  "YOUTUBE",
  "INSTAGRAM",
  "FACEBOOK",
  "X",
  "REDDIT",
  "GOOGLE",
  "BING",
  "AI_SEARCH",
  "WEB",
  "FORUM",
  "GITHUB",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CONTENT_TYPES = ["VIDEO", "CONVERSATION", "SEARCH", "ARTICLE"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const SIGNALS = [
  "POPULAR_NOW",
  "RISING",
  "EMERGING",
  "RECURRING_PROBLEM",
  "SEARCH_INTEREST",
  "CREATIVE_PATTERN",
  "NEW_DEVELOPMENT",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type Signal = (typeof SIGNALS)[number];

export const EVIDENCE_QUALITIES = [
  "ATTRIBUTED_METADATA",
  "PERMITTED_TEXT",
  "INSPECTED_MEDIA",
] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITIES)[number];

export const CATEGORIES = [
  "COFFEE_BREWING",
  "CONTENT_CREATION",
  "CUSTOMER_DISCOVERY",
  "SOFTWARE_DEVELOPMENT",
  "PRODUCTIVITY",
  "FITNESS",
  "GARDENING",
  "COOKING",
  "SKINCARE",
  "TRAVEL",
  "AI",
  "ECOMMERCE",
  "FINANCE",
  "EDUCATION",
  "ENTERTAINMENT",
  "SUSTAINABILITY",
  "MARKETING",
  "SALES",
  "HEALTHCARE",
  "HEALTH_WELLNESS",
  "HOME_SERVICES",
  "REAL_ESTATE",
  "FASHION",
  "BEAUTY",
  "PETS",
  "GAMING",
  "PARENTING",
  "AUTOMOTIVE",
  "LEGAL",
  "RESTAURANTS",
  "SPORTS",
  "CRYPTO",
  "CAREERS",
  "HOME_DECOR",
  "WEDDINGS",
  "OUTDOORS",
  "PHOTOGRAPHY",
  "CRAFTS_DIY",
  "CYBERSECURITY",
  "NONPROFIT",
  "MUSIC_CREATION",
  "DRINKS",
  "GENERAL",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DISCOVER_SCOPES = ["global", "core", "adjacent"] as const;
export type DiscoverScope = (typeof DISCOVER_SCOPES)[number];
export const DISCOVER_CHANNELS = ["search", "ai_search", "conversations", "video"] as const;
export type DiscoverChannel = (typeof DISCOVER_CHANNELS)[number];

/** The bounds `TrendIndexQueryV3` puts on its numeric filters. */
export const FILTER_LIMITS = {
  lookback_hours: { min: 1, max: 720 },
  history_days: { min: 1, max: 90 },
  limit: { min: 1, max: 100 },
} as const;

/** The list fields of a typed niche (`input.niche`), with the most values each accepts. */
export const NICHE_LIST_FIELDS = {
  topics: 20,
  problems: 20,
  audiences: 20,
  exclusions: 20,
  capabilities: 20,
  jobs: 20,
  industry: 20,
  product_categories: 20,
  customer_interests: 20,
  competitors: 20,
  adjacent_categories: 20,
  communities: 10,
  competitor_handles: 40,
  competitor_domains: 20,
  keywords: 20,
} as const;

/** A TrendsFast API key: `tf_<environment>_<visible prefix>.<secret>`. Only the part before
 * the dot may ever be shown. */
export const API_KEY_PATTERN = /^tf_(?:test|live)_[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{32,128}$/;

/** The UUID shape TrendsFast accepts for request, result and context IDs. */
export const UUID_PATTERN =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export function findProduct(idOrCommand: string): Product | undefined {
  return PRODUCTS.find(
    (product) => product.id === idOrCommand || product.command === idOrCommand,
  );
}

export function productById(id: ProductId): Product {
  const product = PRODUCTS.find((entry) => entry.id === id);
  if (!product) throw new TypeError(`Unknown TrendsFast product: ${String(id)}`);
  return product;
}

/** "1 credit", "25 credits" or "free". */
export function creditsLabel(credits: number): string {
  if (credits === 0) return "free";
  return credits === 1 ? "1 credit" : `${credits} credits`;
}
