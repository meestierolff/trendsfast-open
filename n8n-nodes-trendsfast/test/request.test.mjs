import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	catalog,
	effectiveParameters,
	isDisplayed,
	loadNode,
	openapi,
	openapiOperation,
	openapiPath,
	requestBodySchema,
	schemaErrors,
	transport,
} from './helpers.mjs';

const { planCall, httpRequestOptions } = transport;
const properties = loadNode().description.properties;

const CONTEXT_ID = '3f0c2a51-8d4b-4c1e-9f7a-6b2d5e8c1a90';
const RESULT_ID = '5b0d7a52-3c1e-4f6a-9b2d-8e4c1a7f3d90';
const REQUEST_ID = '0d6f3c3e-5b8a-4d6e-9a43-2f1c7b9e8a10';

/** Reads parameters the way n8n does: set values, shown defaults, otherwise the fallback. */
function reader(parameters) {
	const values = effectiveParameters(properties, parameters);
	return (name, fallback) => {
		const shown = properties.some(
			(property) => property.name === name && isDisplayed(property, values),
		);
		if (shown && values[name] !== undefined) return values[name];
		if (fallback !== undefined) return fallback;
		throw new Error(`Could not get parameter "${name}"`);
	};
}

function build(parameters, requestId = REQUEST_ID) {
	const call = planCall(parameters.resource, parameters.operation, reader(parameters));
	return { call, options: httpRequestOptions(call, call.charge ? requestId : undefined) };
}

const SCENARIOS = {
	'Customers run for a saved context': {
		resource: 'product',
		operation: 'run',
		product: 'customers',
		contextId: CONTEXT_ID,
	},
	'Trending run for a saved context': {
		resource: 'product',
		operation: 'run',
		product: 'niche',
		contextId: CONTEXT_ID,
	},
	'Competitors run for a saved context': {
		resource: 'product',
		operation: 'run',
		product: 'competitors',
		contextId: CONTEXT_ID,
	},
	'Formats run for a saved context': {
		resource: 'product',
		operation: 'run',
		product: 'formats',
		contextId: CONTEXT_ID,
	},
	'Search run for a saved context': {
		resource: 'product',
		operation: 'run',
		product: 'search',
		contextId: CONTEXT_ID,
	},
	'Customers read for a website and description, with every detail': {
		resource: 'product',
		operation: 'run',
		product: 'customers',
		brandSource: 'niche',
		websiteUrl: 'example.com',
		brandDescription: 'Invoicing software for freelance designers in Europe',
		brandDetails: {
			topics: 'freelancing, invoicing',
			problems: 'late payments,\nmessy invoices',
			audiences: 'freelance designers',
			competitors: 'Example Invoicing',
			competitorDomains: 'example.org',
			competitorHandles: '@examplebrand',
			communities: 'r/freelance, r/graphic_design',
			keywords: 'invoice template',
			exclusions: 'enterprise ERP',
			adjacentCategories: 'time tracking',
			capabilities: 'recurring invoices',
			jobs: 'send an invoice',
			industry: 'design',
			productCategories: 'invoicing software',
			customerInterests: 'getting paid on time',
			market: 'EU',
			language: 'en',
			platforms: ['REDDIT', 'X'],
		},
		maxCredits: 12,
		options: { lookbackHours: 168, maxItems: 30, includeAdjacent: false, includeGlobal: true },
	},
	'Formats read for a website and description, with chosen content types': {
		resource: 'product',
		operation: 'run',
		product: 'formats',
		brandSource: 'niche',
		brandDescription: 'Invoicing software for freelance designers in Europe',
		options: { contentTypes: ['ARTICLE', 'VIDEO'] },
	},
	'Search read for a website and description': {
		resource: 'product',
		operation: 'run',
		product: 'search',
		brandSource: 'niche',
		brandDescription: 'Invoicing software for freelance designers in Europe',
	},
	'Trending read for a website and description': {
		resource: 'product',
		operation: 'run',
		product: 'niche',
		brandSource: 'niche',
		brandDescription: 'Invoicing software for freelance designers in Europe',
	},
	'global trends query with every filter': {
		resource: 'globalTrend',
		operation: 'query',
		filters: {
			platforms: ['TIKTOK', 'YOUTUBE'],
			contentTypes: ['VIDEO'],
			categories: ['AI', 'MARKETING'],
			signals: ['RISING', 'EMERGING'],
			country: 'us',
			language: 'en-US',
			lookbackHours: 24,
			maxItems: 10,
		},
	},
	'global trends query with no filter': { resource: 'globalTrend', operation: 'query' },
	'question with a context': {
		resource: 'question',
		operation: 'ask',
		question: 'What are freelance designers asking about invoicing?',
		contextId: CONTEXT_ID,
	},
	'question without a context': {
		resource: 'question',
		operation: 'ask',
		question: 'What is rising in AI?',
	},
	'product quote': { resource: 'product', operation: 'getQuote', product: 'search' },
	'result read, second page': {
		resource: 'result',
		operation: 'get',
		resultId: RESULT_ID,
		options: { cursor: 'abc' },
	},
	'result read, first page': { resource: 'result', operation: 'get', resultId: RESULT_ID },
	'request lookup': { resource: 'request', operation: 'get', requestId: REQUEST_ID },
	'wallet read': { resource: 'account', operation: 'getWallet' },
	'context read': { resource: 'account', operation: 'getContext' },
	'history read': { resource: 'account', operation: 'getHistory', options: { cursor: 'next' } },
};

for (const [name, parameters] of Object.entries(SCENARIOS)) {
	test(`${name}: the request matches the OpenAPI contract`, () => {
		const { call, options } = build(parameters);
		const operation = openapiOperation(options.method, options.url);
		assert.ok(operation, `${options.method} ${options.url} is in the OpenAPI`);
		assert.equal(options.baseURL, 'https://trendsfast.com');
		assert.equal(operation['x-required-scope'], call.endpoint.scope);
		assert.equal(operation['x-billable'], call.endpoint.paid);
		assert.deepEqual(operation.security, [{ bearerAuth: [] }]);

		// Nothing in between may resend or redirect a call; every status comes back to the node.
		assert.equal(options.disableFollowRedirect, true);
		assert.equal(options.ignoreHttpStatusErrors, true);
		assert.equal(options.returnFullResponse, true);
		assert.equal(options.json, true);
		assert.equal(options.headers.Accept, 'application/json');
		assert.equal(
			options.headers.Authorization,
			undefined,
			'the credential adds the key, never the node',
		);

		const queryParameters = (operation.parameters ?? []).filter(
			(parameter) => parameter.in === 'query',
		);
		for (const parameter of queryParameters.filter((entry) => entry.required)) {
			assert.ok(options.qs?.[parameter.name] !== undefined, `${parameter.name} is required`);
		}
		for (const [key, value] of Object.entries(options.qs ?? {})) {
			const parameter = queryParameters.find((entry) => entry.name === key);
			assert.ok(parameter, `query parameter ${key} is in the OpenAPI`);
			assert.deepEqual(schemaErrors(parameter.schema, value), [], `query parameter ${key}`);
		}

		if (call.charge) {
			assert.equal(options.method, 'POST');
			assert.equal(options.timeout, catalog.PAID_TIMEOUT_MS);
			assert.equal(options.headers['Content-Type'], 'application/json');
			assert.deepEqual(Object.keys(options.body), ['request_id', 'max_credits', 'input']);
			assert.equal(options.body.request_id, REQUEST_ID);
			assert.deepEqual(
				schemaErrors(requestBodySchema(options.method, options.url), options.body),
				[],
			);
		} else {
			assert.equal(options.method, 'GET');
			assert.equal(options.timeout, catalog.READ_TIMEOUT_MS);
			assert.equal(options.body, undefined);
			assert.equal(options.headers['Content-Type'], undefined);
		}
	});
}

test('every endpoint the node calls exists in the OpenAPI with the same method, scope and billing', () => {
	for (const [name, endpoint] of Object.entries(catalog.ENDPOINTS)) {
		const operation = openapi.paths[endpoint.path]?.[endpoint.method.toLowerCase()];
		assert.ok(operation, `${name}: ${endpoint.method} ${endpoint.path}`);
		assert.equal(operation['x-required-scope'], endpoint.scope, `${name} scope`);
		assert.equal(operation['x-billable'], endpoint.paid, `${name} billing`);
		if (endpoint.paid) {
			const schema = operation.requestBody.content['application/json'].schema;
			assert.deepEqual(schema.required, ['request_id', 'max_credits', 'input']);
			assert.equal(schema.properties.max_credits.maximum, catalog.MAX_CREDITS_CEILING);
		}
	}
	assert.equal(openapiPath('/v3/trends/results/' + RESULT_ID), '/v3/trends/results/{id}');
});

test('a saved-context run sends the product and the context ID, capped at the product price', () => {
	const prices = { customers: 10, niche: 25, competitors: 30, formats: 20, search: 35 };
	for (const [product, credits] of Object.entries(prices)) {
		const { options } = build({
			resource: 'product',
			operation: 'run',
			product,
			contextId: CONTEXT_ID,
		});
		assert.equal(options.url, '/v3/trends/niche');
		assert.equal(options.body.max_credits, credits);
		assert.deepEqual(options.body.input, { product, context_id: CONTEXT_ID });
	}
	// Chosen content types are sent as a filter and override the lens on the server.
	const { options } = build({
		resource: 'product',
		operation: 'run',
		product: 'customers',
		contextId: CONTEXT_ID,
		options: { contentTypes: ['VIDEO'] },
	});
	assert.deepEqual(options.body.input, {
		product: 'customers',
		context_id: CONTEXT_ID,
		filters: { content_types: ['VIDEO'] },
	});
	assert.equal(options.body.max_credits, 10);
});

test('a website-and-description run is a plain niche read: no product, the lens, 3 credits', () => {
	// The server's PRODUCT_CONTENT_TYPES (apps/web/lib/v3/query-service.ts).
	const lenses = {
		customers: ['CONVERSATION'],
		niche: undefined,
		competitors: undefined,
		formats: ['VIDEO'],
		search: ['SEARCH'],
	};
	assert.equal(catalog.NICHE_READ_CREDITS, 3);
	for (const [product, lens] of Object.entries(lenses)) {
		const { call, options } = build({
			resource: 'product',
			operation: 'run',
			product,
			brandSource: 'niche',
			brandDescription: 'Invoicing software for freelance designers',
		});
		const { input } = options.body;
		assert.equal(input.product, undefined, `${product}: a typed niche names no product`);
		assert.equal(input.context_id, undefined);
		assert.deepEqual(input.niche, { description: 'Invoicing software for freelance designers' });
		assert.deepEqual(input.filters, lens ? { content_types: lens } : undefined, `${product} lens`);
		assert.equal(options.body.max_credits, 3, `${product}: the plain niche read's price`);
		assert.equal(call.label, `the ${catalog.findProduct(product).name} read`);
		assert.deepEqual(schemaErrors(requestBodySchema('POST', '/v3/trends/niche'), options.body), []);
	}

	const { options } = build(
		SCENARIOS['Customers read for a website and description, with every detail'],
	);
	const { input } = options.body;
	assert.equal(input.product, undefined);
	assert.equal(input.context_id, undefined);
	assert.equal(input.niche.url, 'https://example.com');
	assert.deepEqual(input.niche.problems, ['late payments', 'messy invoices']);
	assert.deepEqual(input.niche.platforms, ['REDDIT', 'X']);
	assert.deepEqual(input.filters, {
		content_types: ['CONVERSATION'],
		lookback_hours: 168,
		limit: 30,
	});
	assert.equal(input.include_adjacent, false);
	assert.equal(options.body.max_credits, 12, 'a set Max Credits is still the cap');

	// Content types the user chose win over the product's lens.
	const chosen = build({
		resource: 'product',
		operation: 'run',
		product: 'formats',
		brandSource: 'niche',
		brandDescription: 'Invoicing software for freelance designers',
		options: { contentTypes: ['ARTICLE', 'CONVERSATION'] },
	}).options.body.input;
	assert.deepEqual(chosen.filters, { content_types: ['ARTICLE', 'CONVERSATION'] });
	assert.equal(chosen.product, undefined);
});

test('the global query maps filters to their API names and normalises the country', () => {
	const { options } = build(SCENARIOS['global trends query with every filter']);
	assert.deepEqual(options.body.input, {
		platforms: ['TIKTOK', 'YOUTUBE'],
		content_types: ['VIDEO'],
		categories: ['AI', 'MARKETING'],
		signals: ['RISING', 'EMERGING'],
		country: 'US',
		language: 'en-US',
		lookback_hours: 24,
		limit: 10,
	});
	assert.equal(options.body.max_credits, 1);
	assert.deepEqual(build(SCENARIOS['global trends query with no filter']).options.body.input, {});
	assert.equal(build(SCENARIOS['question without a context']).options.body.max_credits, 5);
});

test('lists are split on commas and lines, trimmed and de-duplicated', () => {
	assert.deepEqual(transport.parseTerms(' a, b ,,a\nc ', 'Topics', 20), ['a', 'b', 'c']);
	assert.deepEqual(transport.parseTerms(['x', ' y ', 'x'], 'Topics', 20), ['x', 'y']);
	assert.deepEqual(transport.parseTerms('', 'Topics', 20), []);
});

test('input TrendsFast would reject is refused before anything is sent', () => {
	const base = { resource: 'product', operation: 'run', product: 'customers' };
	const niche = {
		...base,
		brandSource: 'niche',
		brandDescription: 'Invoicing software for designers',
	};
	const cases = [
		[{ ...base, contextId: '' }, /'Context ID' is empty/],
		[{ ...base, contextId: 'not-a-uuid' }, /'Context ID' must be a UUID/],
		[{ ...niche, brandDescription: 'ab' }, /'Brand Description' must be 3 to 2,000/],
		[{ ...niche, brandDescription: 'x'.repeat(2001) }, /'Brand Description' must be 3 to 2,000/],
		// TrendsFast's own URL rule: public HTTPS, no credentials, no port.
		...[
			'ftp://example.com',
			'http://example.com',
			'https://user:pw@example.com',
			'https://example.com:8443',
		].map((websiteUrl) => [
			{ ...niche, websiteUrl },
			/'Website URL' must be a public https address/,
		]),
		[{ ...niche, websiteUrl: 'https://' }, /'Website URL' is not a valid URL/],
		[
			{
				...niche,
				brandDetails: { communities: Array.from({ length: 11 }, (_, i) => `r/c${i}`).join(',') },
			},
			/'Communities' has 11 entries; the most is 10/,
		],
		[{ ...niche, brandDetails: { topics: 'x'.repeat(181) } }, /longer than 180 characters/],
		[{ ...niche, brandDetails: { platforms: ['MYSPACE'] } }, /unknown value: MYSPACE/],
		[
			{ ...niche, options: { contentTypes: ['PODCAST'] } },
			/'Content Types' has an unknown value: PODCAST/,
		],
		[
			{ ...base, contextId: CONTEXT_ID, maxCredits: 1001 },
			/'Max Credits' must be a whole number from 0 to 1000/,
		],
		[{ ...base, contextId: CONTEXT_ID, maxCredits: 2.5 }, /'Max Credits' must be a whole number/],
		[{ ...base, contextId: CONTEXT_ID, options: { maxItems: 0 } }, /'Max Items'/],
		[{ ...base, contextId: CONTEXT_ID, options: { lookbackHours: 721 } }, /'Lookback Hours'/],
		[{ resource: 'globalTrend', operation: 'query', filters: { country: 'USA' } }, /'Country'/],
		[
			{ resource: 'globalTrend', operation: 'query', filters: { language: 'english' } },
			/'Language'/,
		],
		[{ resource: 'question', operation: 'ask', question: 'hi' }, /'Question' must be 3 to 1,000/],
		[{ resource: 'result', operation: 'get', resultId: '../wallet' }, /'Result ID' must be a UUID/],
		[{ resource: 'request', operation: 'get', requestId: '' }, /'Request ID' is empty/],
		[
			{
				resource: 'result',
				operation: 'get',
				resultId: RESULT_ID,
				options: { cursor: 'c'.repeat(513) },
			},
			/'Cursor'/,
		],
		[{ resource: 'product', operation: 'delete' }, /not available/],
	];
	for (const [parameters, message] of cases) {
		assert.throws(
			() => planCall(parameters.resource, parameters.operation, reader(parameters)),
			(error) => error.name === 'TrendsFastInputError' && message.test(error.message),
			`expected ${message} for ${JSON.stringify(parameters).slice(0, 120)}`,
		);
	}
	const call = planCall(
		'question',
		'ask',
		reader({ resource: 'question', operation: 'ask', question: 'What is new?' }),
	);
	assert.throws(() => httpRequestOptions(call, undefined), /needs a request ID/);
});
