import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	catalog,
	effectiveParameters,
	isDisplayed,
	loadCredential,
	loadNode,
	openapi,
	openapiOperation,
	packageRoot,
	readJson,
} from './helpers.mjs';

const node = loadNode();
const { description } = node;
const properties = description.properties;

const PAID = ['product.run', 'globalTrend.query', 'question.ask'];
const FREE = [
	'product.getQuote',
	'result.get',
	'request.get',
	'account.getWallet',
	'account.getContext',
	'account.getHistory',
];

function operationsOf(resource) {
	const property = properties.find(
		(entry) =>
			entry.name === 'operation' && entry.displayOptions?.show?.resource?.includes(resource),
	);
	return property?.options ?? [];
}

function shownProperties(parameters) {
	const values = effectiveParameters(properties, parameters);
	return properties.filter((property) => isDisplayed(property, values));
}

test('the node is TrendsFast, version 1, usable as an AI agent tool', () => {
	assert.equal(description.displayName, 'TrendsFast');
	assert.equal(description.name, 'trendsFast');
	assert.equal(description.version, 1);
	assert.equal(description.usableAsTool, true);
	assert.deepEqual(description.inputs, ['main']);
	assert.deepEqual(description.outputs, ['main']);
	assert.deepEqual(description.credentials, [{ name: 'trendsFastApi', required: true }]);
	assert.ok(description.subtitle);
	assert.equal(typeof node.execute, 'function');
	assert.equal(description.requestDefaults, undefined, 'calls are built in execute(), not routed');
	for (const icon of Object.values(description.icon)) {
		const file = join(packageRoot, 'dist/nodes/TrendsFast', icon.replace('file:', ''));
		assert.ok(existsSync(file), `${icon} is missing from dist`);
	}
});

test('it offers the agreed resources and operations', () => {
	const resources = properties.find((property) => property.name === 'resource');
	assert.deepEqual(resources.options.map((option) => option.value).sort(), [
		'account',
		'globalTrend',
		'product',
		'question',
		'request',
		'result',
	]);
	const keys = resources.options.flatMap((resource) =>
		operationsOf(resource.value).map((operation) => `${resource.value}.${operation.value}`),
	);
	assert.deepEqual(keys.sort(), [...PAID, ...FREE].sort());
	assert.equal(operationsOf('request')[0].name, 'Get by Request ID');
	assert.deepEqual(
		operationsOf('product').map((operation) => operation.name),
		['Get Quote', 'Run'],
	);
});

test('every operation says what it costs', () => {
	for (const key of [...PAID, ...FREE]) {
		const [resource, value] = key.split('.');
		const operation = operationsOf(resource).find((option) => option.value === value);
		assert.ok(operation.action, `${key} needs an action`);
		if (PAID.includes(key)) {
			assert.match(operation.description, /\d+ credits?/, `${key} must state its price`);
			assert.match(
				operation.description,
				/empty result costs 0/,
				`${key} must say an empty result is free`,
			);
		} else {
			assert.match(operation.description, /Free/, `${key} must say it is free`);
		}
	}
	const run = operationsOf('product').find((option) => option.value === 'run');
	for (const [name, credits] of [
		['Customers', 10],
		['Trending', 25],
		['Competitors', 30],
		['Formats', 20],
		['Search', 35],
	]) {
		assert.match(run.description, new RegExp(`${name} ${credits}\\b`));
	}
	assert.match(run.description, /For a website and description: 3 credits\./);
});

test('Max Credits is required and defaults to the price of what runs', () => {
	const prices = { customers: 10, niche: 25, competitors: 30, formats: 20, search: 35 };
	for (const [product, credits] of Object.entries(prices)) {
		// A saved brand context, the default brand source, pays the product's own price.
		const shown = shownProperties({ resource: 'product', operation: 'run', product }).filter(
			(property) => property.name === 'maxCredits',
		);
		assert.equal(shown.length, 1, `exactly one Max Credits for ${product}`);
		assert.equal(shown[0].default, credits);
		assert.equal(shown[0].required, true);
		assert.deepEqual(shown[0].typeOptions, { minValue: 0, maxValue: 1000, numberPrecision: 0 });
		assert.match(shown[0].description, new RegExp(`costs ${credits} credits`));
		const option = properties
			.find((property) => property.name === 'product')
			.options.find((entry) => entry.value === product);
		assert.match(
			option.description,
			new RegExp(
				`${credits} credits for a saved brand context; 3 for a website and description\\.$`,
			),
		);

		// A website and description is a plain niche read at 3 credits, whatever the product.
		const typed = shownProperties({
			resource: 'product',
			operation: 'run',
			product,
			brandSource: 'niche',
		}).filter((property) => property.name === 'maxCredits');
		assert.equal(typed.length, 1, `exactly one Max Credits for a typed ${product}`);
		assert.equal(typed[0].default, 3);
		assert.equal(typed[0].required, true);
		assert.match(typed[0].description, /costs 3 credits/);
	}
	for (const [parameters, credits] of [
		[{ resource: 'globalTrend', operation: 'query' }, 1],
		[{ resource: 'question', operation: 'ask' }, 5],
	]) {
		const shown = shownProperties(parameters).filter((property) => property.name === 'maxCredits');
		assert.equal(shown.length, 1);
		assert.equal(shown[0].default, credits);
		assert.equal(shown[0].required, true);
	}
	for (const parameters of [
		{ resource: 'product', operation: 'getQuote' },
		{ resource: 'result', operation: 'get' },
		{ resource: 'request', operation: 'get' },
		{ resource: 'account', operation: 'getWallet' },
	]) {
		assert.ok(!shownProperties(parameters).some((property) => property.name === 'maxCredits'));
	}
});

test('the brand source says what a typed niche reads, costs and lacks', () => {
	const brandSource = properties.find((property) => property.name === 'brandSource');
	assert.equal(brandSource.default, 'context', 'a saved brand context is the default');
	const choice = (value) => brandSource.options.find((option) => option.value === value);
	assert.match(choice('context').description, /collects your brand’s own sources fresh/);
	assert.equal(
		choice('niche').description,
		'Describe the brand here. TrendsFast reads its existing index through that product’s lens for 3 credits. Fresh collection, community rules and Trending’s topic history need a saved brand context.',
	);
	// The lens mirrors the server's PRODUCT_CONTENT_TYPES (apps/web/lib/v3/query-service.ts).
	assert.deepEqual(
		Object.fromEntries(catalog.PRODUCTS.map((product) => [product.id, product.lens ?? null])),
		{
			customers: ['CONVERSATION'],
			niche: null,
			competitors: null,
			formats: ['VIDEO'],
			search: ['SEARCH'],
		},
	);
	const options = properties.find(
		(property) =>
			property.name === 'options' && property.displayOptions?.show?.operation?.includes('run'),
	);
	const contentTypes = options.options.find((option) => option.name === 'contentTypes');
	assert.equal(contentTypes.type, 'multiOptions');
	assert.deepEqual(contentTypes.default, []);
	assert.match(contentTypes.description, /Leave it empty for the product’s lens/);
});

test('every paid operation has an optional Request ID; the lookup requires one', () => {
	for (const key of PAID) {
		const [resource, operation] = key.split('.');
		const requestId = shownProperties({ resource, operation }).find(
			(property) => property.name === 'requestId',
		);
		assert.ok(requestId, `${key} needs a Request ID field`);
		assert.notEqual(requestId.required, true);
		assert.equal(requestId.default, '');
		assert.match(requestId.description, /retry/);
	}
	const lookup = shownProperties({ resource: 'request', operation: 'get' }).find(
		(property) => property.name === 'requestId',
	);
	assert.equal(lookup.required, true);
});

test('the product, platform, content type, category and signal choices match the OpenAPI', () => {
	const niche = openapiOperation('POST', '/v3/trends/niche').requestBody.content['application/json']
		.schema.properties.input.properties;
	const productValues = properties
		.find((property) => property.name === 'product')
		.options.map((option) => option.value);
	assert.deepEqual([...productValues].sort(), [...niche.product.enum].sort());

	const global = openapiOperation('POST', '/v3/trends/global').requestBody.content[
		'application/json'
	].schema.properties.input.properties;
	const sameValues = (choices, schema) =>
		assert.deepEqual(choices.map((choice) => choice.value).sort(), [...schema.items.enum].sort());
	sameValues(catalog.PLATFORM_CHOICES, global.platforms);
	sameValues(catalog.CONTENT_TYPE_CHOICES, global.content_types);
	sameValues(catalog.CATEGORY_CHOICES, global.categories);
	sameValues(catalog.SIGNAL_CHOICES, global.signals);
	sameValues(catalog.PLATFORM_CHOICES, niche.niche.properties.platforms);

	const nicheFields = Object.keys(niche.niche.properties);
	for (const field of catalog.NICHE_TERM_FIELDS) {
		assert.ok(nicheFields.includes(field.api), `${field.api} is a niche field`);
		assert.equal(field.max, niche.niche.properties[field.api].maxItems, `${field.api} limit`);
	}
});

test('the TrendsFast API credential sends the key as a bearer token and tests on the free wallet', () => {
	const credential = loadCredential();
	assert.equal(credential.name, 'trendsFastApi');
	assert.equal(credential.displayName, 'TrendsFast API');
	assert.equal(credential.properties.length, 1);
	const [apiKey] = credential.properties;
	assert.equal(apiKey.name, 'apiKey');
	assert.equal(apiKey.type, 'string');
	assert.equal(apiKey.required, true);
	assert.deepEqual(apiKey.typeOptions, { password: true });
	assert.deepEqual(credential.authenticate, {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
	});
	assert.deepEqual(credential.test.request, {
		baseURL: 'https://trendsfast.com',
		url: '/v3/trends/wallet',
		method: 'GET',
	});
	const wallet = openapiOperation('GET', '/v3/trends/wallet');
	assert.equal(wallet['x-billable'], false, 'the credential test must never spend credits');
	assert.deepEqual(wallet.security, [{ bearerAuth: [] }]);
	assert.deepEqual(openapi.components.securitySchemes.bearerAuth, {
		type: 'http',
		scheme: 'bearer',
	});
	for (const icon of Object.values(credential.icon)) {
		assert.ok(existsSync(join(packageRoot, 'dist/credentials', icon.replace('file:', ''))));
	}
});

test('package.json meets the community-node rules', () => {
	const manifest = readJson('package.json');
	assert.match(manifest.name, /^n8n-nodes-/);
	assert.ok(manifest.keywords.includes('n8n-community-node-package'));
	assert.equal(manifest.license, 'MIT');
	assert.equal(
		manifest.dependencies,
		undefined,
		'verified nodes may not have runtime dependencies',
	);
	assert.deepEqual(manifest.peerDependencies, { 'n8n-workflow': '*' });
	assert.equal(manifest.overrides, undefined);
	assert.deepEqual(manifest.files, ['dist']);
	assert.equal(manifest.n8n.n8nNodesApiVersion, 1);
	assert.equal(manifest.n8n.strict, true);
	for (const file of [...manifest.n8n.nodes, ...manifest.n8n.credentials]) {
		assert.ok(existsSync(join(packageRoot, file)), `${file} is built`);
	}
	for (const script of ['prepare', 'preinstall', 'install', 'postinstall', 'prepublish']) {
		assert.equal(manifest.scripts[script], undefined, `no ${script} script`);
	}
	assert.equal(manifest.scripts.prepublishOnly, 'n8n-node prerelease');
	for (const version of Object.values(manifest.devDependencies)) {
		assert.match(version, /^\d+\.\d+\.\d+$/, 'dev dependencies are pinned exactly');
	}
	assert.ok(existsSync(join(packageRoot, 'LICENSE.md')));
	const eslintConfig = readFileSync(join(packageRoot, 'eslint.config.mjs'), 'utf8');
	assert.equal(
		eslintConfig.replace(/\s+/g, ' ').trim(),
		"import { config } from '@n8n/node-cli/eslint'; export default config;",
		'strict mode requires the default lint config',
	);
});

test('the codex file uses supported categories and the documentation links', () => {
	const codex = readJson('nodes/TrendsFast/TrendsFast.node.json');
	const allowed = [
		'Analytics',
		'Communication',
		'Data & Storage',
		'Development',
		'Finance & Accounting',
		'Marketing & Content',
		'Miscellaneous',
		'Productivity',
		'Sales',
		'Utility',
	];
	assert.ok(codex.categories.length > 0);
	for (const category of codex.categories) assert.ok(allowed.includes(category), category);
	assert.equal(codex.resources.credentialDocumentation[0].url, 'https://trendsfast.com/docs#auth');
});
