import type { INodeProperties } from 'n8n-workflow';
import {
	CONTENT_TYPE_CHOICES,
	NICHE_READ_CREDITS,
	NICHE_TERM_FIELDS,
	PLATFORM_CHOICES,
	PRODUCT_PRICE_LIST,
	PRODUCTS,
	type Product,
} from '../catalog';
import { maxCreditsField, requestIdField } from './shared';

const showProduct = { resource: ['product'] };
const showRun = { resource: ['product'], operation: ['run'] };
const showContext = { ...showRun, brandSource: ['context'] };
const showNiche = { ...showRun, brandSource: ['niche'] };

const byDisplayName = (a: INodeProperties, b: INodeProperties) =>
	a.displayName.localeCompare(b.displayName);

/** "What are my customers stuck on? … 10 credits for a saved brand context; 3 for …" */
function describeProduct(product: Product): string {
	return `${product.summary} ${product.credits} credits for a saved brand context; ${NICHE_READ_CREDITS} for a website and description.`;
}

/** The Website and Description choice: a plain niche read through the product's lens. */
function describeNicheSource(): string {
	return `Describe the brand here. TrendsFast reads its existing index through that product’s lens for ${NICHE_READ_CREDITS} credits. Fresh collection, community rules and Trending’s topic history need a saved brand context.`;
}

/** The Run operation: both brand sources and their prices. */
function describeRun(): string {
	return `Run one of the five products for your brand. For a saved brand context: ${PRODUCT_PRICE_LIST} credits. For a website and description: ${NICHE_READ_CREDITS} credits. An empty result costs 0.`;
}

export const productOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showProduct },
		options: [
			{
				name: 'Get Quote',
				value: 'getQuote',
				action: 'Get product quote',
				description: 'Get what a product costs right now, in credits. Free.',
			},
			{
				name: 'Run',
				value: 'run',
				action: 'Run product',
				description: describeRun(),
			},
		],
		default: 'run',
	},
];

const brandDetailFields: INodeProperties[] = [
	...NICHE_TERM_FIELDS.map(
		(field): INodeProperties => ({
			displayName: field.displayName,
			name: field.param,
			type: 'string',
			default: '',
			placeholder: field.example,
			description: `${field.meaning}. Comma-separated, at most ${field.max}.`,
		}),
	),
	{
		displayName: 'Language',
		name: 'language',
		type: 'string',
		default: '',
		placeholder: 'e.g. en',
		description: 'The language of your audience, in at most 20 characters',
	},
	{
		displayName: 'Market',
		name: 'market',
		type: 'string',
		default: '',
		placeholder: 'e.g. EU',
		description: 'Where the brand sells, in at most 100 characters',
	},
	{
		displayName: 'Platforms',
		name: 'platforms',
		type: 'multiOptions',
		options: PLATFORM_CHOICES,
		default: [],
		description: 'The platforms where your audience spends time',
	},
];

/** Collection options are listed alphabetically, as n8n's own nodes do. */
const brandDetails = [...brandDetailFields].sort(byDisplayName);

export const productFields: INodeProperties[] = [
	{
		displayName: 'Product',
		name: 'product',
		type: 'options',
		noDataExpression: true,
		required: true,
		displayOptions: { show: showProduct },
		options: [...PRODUCTS]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((product) => ({
				name: product.name,
				value: product.id,
				description: describeProduct(product),
			})),
		default: 'customers',
		description: 'Which of the five products to run or quote',
	},
	{
		displayName: 'Brand Source',
		name: 'brandSource',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showRun },
		options: [
			{
				name: 'Saved Brand Context',
				value: 'context',
				description:
					'Use the brand TrendsFast already knows, by its context ID. A run collects your brand’s own sources fresh first, at the product’s price.',
			},
			{
				name: 'Website and Description',
				value: 'niche',
				description: describeNicheSource(),
			},
		],
		default: 'context',
		description: 'Which brand to read for',
	},
	{
		displayName: 'Context ID',
		name: 'contextId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 3f0c2a51-8d4b-4c1e-9f7a-6b2d5e8c1a90',
		displayOptions: { show: showContext },
		description:
			"Your saved brand context. Get it for free with Account > Get Context; it is 'context.context_id' in that output.",
	},
	{
		displayName: 'Website URL',
		name: 'websiteUrl',
		type: 'string',
		default: '',
		placeholder: 'e.g. https://example.com',
		displayOptions: { show: showNiche },
		description:
			'Your website, sent with the description. Matching uses the description and the brand details below.',
	},
	{
		displayName: 'Brand Description',
		name: 'brandDescription',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		placeholder: 'e.g. Invoicing software for freelance designers in Europe',
		displayOptions: { show: showNiche },
		description: 'What the brand does and for whom, in 3 to 2,000 characters',
	},
	{
		displayName: 'Brand Details',
		name: 'brandDetails',
		type: 'collection',
		placeholder: 'Add Detail',
		default: {},
		displayOptions: { show: showNiche },
		options: brandDetails,
	},
	...PRODUCTS.map((product) =>
		maxCreditsField(
			{ ...showContext, product: [product.id] },
			`${product.name} for a saved brand context`,
			product.credits,
		),
	),
	maxCreditsField(showNiche, 'A website and description read', NICHE_READ_CREDITS),
	requestIdField(showRun),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: showRun },
		options: [
			{
				displayName: 'Content Types',
				name: 'contentTypes',
				type: 'multiOptions',
				options: CONTENT_TYPE_CHOICES,
				default: [],
				description:
					'Which kinds of content to read. Leave it empty for the product’s lens: Customers reads conversations, Formats videos and Search searches; Trending and Competitors read everything.',
			},
			{
				displayName: 'Include Adjacent Niches',
				name: 'includeAdjacent',
				type: 'boolean',
				default: true,
				description: 'Whether to also read the niches next to yours',
			},
			{
				displayName: 'Include Global Trends',
				name: 'includeGlobal',
				type: 'boolean',
				default: true,
				description: 'Whether to include broad trends that matter to your niche',
			},
			{
				displayName: 'Lookback Hours',
				name: 'lookbackHours',
				type: 'number',
				default: 72,
				typeOptions: { minValue: 1, maxValue: 720, numberPrecision: 0 },
				description: 'How far back to read, in hours, from 1 to 720',
			},
			{
				displayName: 'Max Items',
				name: 'maxItems',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
				description: 'The most items to return, from 1 to 100',
			},
		],
	},
];
