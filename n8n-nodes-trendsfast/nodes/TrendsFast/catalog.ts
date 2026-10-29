/**
 * Where each TrendsFast operation lives, which key scope it needs and what it costs.
 *
 * The routes and limits follow https://trendsfast.com/v3/openapi.json (contract
 * `trends-api-v3`). The credit prices are the public prices on 2026-10-28; the free quote
 * (GET /v3/trends/quote) is the authority at run time, and TrendsFast never charges more than
 * the `max_credits` a call carries.
 */

export const TRENDSFAST_BASE_URL = 'https://trendsfast.com';

export const CREDENTIAL_TYPE = 'trendsFastApi';

/** The highest `max_credits` the API accepts on one call. */
export const MAX_CREDITS_CEILING = 1000;

/**
 * A paid call waits longer than the server's own 120-second limit, so a slow product run is
 * answered instead of being cut off on this side and left with an unknown outcome.
 */
export const PAID_TIMEOUT_MS = 150_000;

export const READ_TIMEOUT_MS = 30_000;

export type Scope = 'trends:query' | 'trends:read' | 'credits:read';

export interface Endpoint {
	method: 'GET' | 'POST';
	path: string;
	scope: Scope;
	/** Whether the call can spend credits, and so carries a request ID and Max Credits. */
	paid: boolean;
}

export const ENDPOINTS = {
	niche: { method: 'POST', path: '/v3/trends/niche', scope: 'trends:query', paid: true },
	global: { method: 'POST', path: '/v3/trends/global', scope: 'trends:query', paid: true },
	ask: { method: 'POST', path: '/v3/trends/ask', scope: 'trends:query', paid: true },
	quote: { method: 'GET', path: '/v3/trends/quote', scope: 'credits:read', paid: false },
	result: { method: 'GET', path: '/v3/trends/results/{id}', scope: 'trends:read', paid: false },
	request: { method: 'GET', path: '/v3/trends/requests/{id}', scope: 'trends:read', paid: false },
	wallet: { method: 'GET', path: '/v3/trends/wallet', scope: 'credits:read', paid: false },
	context: { method: 'GET', path: '/v3/trends/context', scope: 'trends:read', paid: false },
	history: { method: 'GET', path: '/v3/trends/history', scope: 'credits:read', paid: false },
} as const satisfies Record<string, Endpoint>;

export type ProductId = 'customers' | 'niche' | 'competitors' | 'formats' | 'search';

export type ContentType = 'VIDEO' | 'CONVERSATION' | 'SEARCH' | 'ARTICLE';

export interface Product {
	id: ProductId;
	/** The public product name. `niche` is sold as Trending. */
	name: string;
	/** What a run for a saved brand context costs: the product's own price. */
	credits: number;
	summary: string;
	/**
	 * The content types the product reads through, as the server's PRODUCT_CONTENT_TYPES
	 * (apps/web/lib/v3/query-service.ts) presets them. None means every type.
	 */
	lens?: readonly ContentType[];
}

/** The five products, in the order a founder needs them. */
export const PRODUCTS: readonly Product[] = [
	{
		id: 'customers',
		name: 'Customers',
		credits: 10,
		summary:
			'What are my customers stuck on? Conversations where people like your customers describe a problem, ask a question or request something.',
		lens: ['CONVERSATION'],
	},
	{
		id: 'niche',
		name: 'Trending',
		credits: 25,
		summary:
			'What is trending in my niche, and next door? Posts, videos and searches gaining attention in your niche, then in the niches next to it.',
	},
	{
		id: 'competitors',
		name: 'Competitors',
		credits: 30,
		summary:
			'What are my competitors doing? Recent posts from your competitors’ accounts, with how each one performed.',
	},
	{
		id: 'formats',
		name: 'Formats',
		credits: 20,
		summary:
			'What videos work in my niche? Short videos around your niche with their views and engagement, and the opening lines of the top videos.',
		lens: ['VIDEO'],
	},
	{
		id: 'search',
		name: 'Search',
		credits: 35,
		summary:
			'What do people search for, and what do AI assistants answer? Search interest around your niche, and what AI assistants answer to your category’s buyer question.',
		lens: ['SEARCH'],
	},
];

/**
 * A plain niche read, with no product: what a run for a website and description costs. The
 * server never collects for a typed niche, so the node sends no product for it and reads the
 * index through the product's lens instead of paying the product's price.
 */
export const NICHE_READ_CREDITS = 3;

export const GLOBAL_TRENDS_CREDITS = 1;

export const ASK_CREDITS = 5;

/** "Customers 10, Trending 25, …" for operation descriptions. */
export const PRODUCT_PRICE_LIST = PRODUCTS.map(
	(product) => `${product.name} ${product.credits}`,
).join(', ');

export function findProduct(id: unknown): Product | undefined {
	return PRODUCTS.find((product) => product.id === id);
}

export interface Choice {
	name: string;
	value: string;
}

function choices(labels: Record<string, string>): Choice[] {
	return Object.entries(labels)
		.map(([value, name]) => ({ name, value }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export const PLATFORM_CHOICES = choices({
	AI_SEARCH: 'AI Search',
	BING: 'Bing',
	FACEBOOK: 'Facebook',
	FORUM: 'Forum',
	GITHUB: 'GitHub',
	GOOGLE: 'Google',
	INSTAGRAM: 'Instagram',
	REDDIT: 'Reddit',
	TIKTOK: 'TikTok',
	WEB: 'Web',
	X: 'X',
	YOUTUBE: 'YouTube',
});

export const CONTENT_TYPE_CHOICES = choices({
	ARTICLE: 'Article',
	CONVERSATION: 'Conversation',
	SEARCH: 'Search',
	VIDEO: 'Video',
});

export const SIGNAL_CHOICES = choices({
	CREATIVE_PATTERN: 'Creative Pattern',
	EMERGING: 'Emerging',
	INSUFFICIENT_EVIDENCE: 'Insufficient Evidence',
	NEW_DEVELOPMENT: 'New Development',
	POPULAR_NOW: 'Popular Now',
	RECURRING_PROBLEM: 'Recurring Problem',
	RISING: 'Rising',
	SEARCH_INTEREST: 'Search Interest',
});

export const CATEGORY_CHOICES = choices({
	AI: 'AI',
	AUTOMOTIVE: 'Automotive',
	BEAUTY: 'Beauty',
	CAREERS: 'Careers',
	COFFEE_BREWING: 'Coffee Brewing',
	CONTENT_CREATION: 'Content Creation',
	COOKING: 'Cooking',
	CRAFTS_DIY: 'Crafts and DIY',
	CRYPTO: 'Crypto',
	CUSTOMER_DISCOVERY: 'Customer Discovery',
	CYBERSECURITY: 'Cybersecurity',
	DRINKS: 'Drinks',
	ECOMMERCE: 'Ecommerce',
	EDUCATION: 'Education',
	ENTERTAINMENT: 'Entertainment',
	FASHION: 'Fashion',
	FINANCE: 'Finance',
	FITNESS: 'Fitness',
	GAMING: 'Gaming',
	GARDENING: 'Gardening',
	GENERAL: 'General',
	HEALTHCARE: 'Healthcare',
	HEALTH_WELLNESS: 'Health and Wellness',
	HOME_DECOR: 'Home Decor',
	HOME_SERVICES: 'Home Services',
	LEGAL: 'Legal',
	MARKETING: 'Marketing',
	MUSIC_CREATION: 'Music Creation',
	NONPROFIT: 'Nonprofit',
	OUTDOORS: 'Outdoors',
	PARENTING: 'Parenting',
	PETS: 'Pets',
	PHOTOGRAPHY: 'Photography',
	PRODUCTIVITY: 'Productivity',
	REAL_ESTATE: 'Real Estate',
	RESTAURANTS: 'Restaurants',
	SALES: 'Sales',
	SKINCARE: 'Skincare',
	SOFTWARE_DEVELOPMENT: 'Software Development',
	SPORTS: 'Sports',
	SUSTAINABILITY: 'Sustainability',
	TRAVEL: 'Travel',
	WEDDINGS: 'Weddings',
});

/** List fields of a temporary niche: the node parameter, the API field and its limits. */
export interface TermField {
	param: string;
	api: string;
	displayName: string;
	max: number;
	meaning: string;
	example: string;
}

export const NICHE_TERM_FIELDS: readonly TermField[] = [
	{
		param: 'adjacentCategories',
		api: 'adjacent_categories',
		displayName: 'Adjacent Categories',
		max: 20,
		meaning: 'Categories next to yours, to widen the read',
		example: 'e.g. time tracking, accounting',
	},
	{
		param: 'audiences',
		api: 'audiences',
		displayName: 'Audiences',
		max: 20,
		meaning: 'Who the brand serves',
		example: 'e.g. freelance designers, small studios',
	},
	{
		param: 'capabilities',
		api: 'capabilities',
		displayName: 'Capabilities',
		max: 20,
		meaning: 'What the product can do',
		example: 'e.g. recurring invoices, VAT handling',
	},
	{
		param: 'communities',
		api: 'communities',
		displayName: 'Communities',
		max: 10,
		meaning: 'Where your audience gathers, such as subreddits',
		example: 'e.g. r/freelance, r/graphic_design',
	},
	{
		param: 'competitorDomains',
		api: 'competitor_domains',
		displayName: 'Competitor Domains',
		max: 20,
		meaning: 'Competitor websites, matched by exact host or subdomain',
		example: 'e.g. example.com, example.org',
	},
	{
		param: 'competitorHandles',
		api: 'competitor_handles',
		displayName: 'Competitor Handles',
		max: 40,
		meaning: 'Exact public handles or channel IDs of competitors and their founders',
		example: 'e.g. @examplebrand',
	},
	{
		param: 'competitors',
		api: 'competitors',
		displayName: 'Competitors',
		max: 20,
		meaning: 'Competitor names',
		example: 'e.g. Example Invoicing',
	},
	{
		param: 'customerInterests',
		api: 'customer_interests',
		displayName: 'Customer Interests',
		max: 20,
		meaning: 'What your customers care about',
		example: 'e.g. getting paid on time',
	},
	{
		param: 'exclusions',
		api: 'exclusions',
		displayName: 'Exclusions',
		max: 20,
		meaning: 'Topics to leave out',
		example: 'e.g. enterprise ERP',
	},
	{
		param: 'industry',
		api: 'industry',
		displayName: 'Industry',
		max: 20,
		meaning: 'The industries the brand works in',
		example: 'e.g. design, creative services',
	},
	{
		param: 'jobs',
		api: 'jobs',
		displayName: 'Jobs',
		max: 20,
		meaning: 'Jobs your customers want done',
		example: 'e.g. send an invoice, chase a late payment',
	},
	{
		param: 'keywords',
		api: 'keywords',
		displayName: 'Keywords',
		max: 20,
		meaning: 'Phrases your audience types into search engines and AI assistants',
		example: 'e.g. invoice template, freelance invoicing',
	},
	{
		param: 'problems',
		api: 'problems',
		displayName: 'Problems',
		max: 20,
		meaning: 'Problems the brand solves',
		example: 'e.g. late payments, messy invoices',
	},
	{
		param: 'productCategories',
		api: 'product_categories',
		displayName: 'Product Categories',
		max: 20,
		meaning: 'What kind of product it is',
		example: 'e.g. invoicing software',
	},
	{
		param: 'topics',
		api: 'topics',
		displayName: 'Topics',
		max: 20,
		meaning: 'Topics the brand is about',
		example: 'e.g. freelancing, invoicing',
	},
];

/** The longest single term the API accepts in a list field. */
export const TERM_MAX_LENGTH = 180;
