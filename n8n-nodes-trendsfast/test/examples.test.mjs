import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	effectiveParameters,
	fixture,
	isDisplayed,
	loadNode,
	openapiOperation,
	packageRoot,
	requestBodySchema,
	schemaErrors,
	transport,
} from './helpers.mjs';

const TRENDSFAST = 'n8n-nodes-trendsfast.trendsFast';
const CONTEXT_ID = '3f0c2a51-8d4b-4c1e-9f7a-6b2d5e8c1a90';
const REQUEST_ID = '0d6f3c3e-5b8a-4d6e-9a43-2f1c7b9e8a10';
const properties = loadNode().description.properties;
const quoteSchema = openapiOperation('GET', '/v3/trends/quote').responses['200'].content[
	'application/json'
].schema;
const examplesDir = join(packageRoot, 'examples');
const files = readdirSync(examplesDir).filter((file) => file.endsWith('.json'));
const workflows = Object.fromEntries(
	files.map((file) => [file, JSON.parse(readFileSync(join(examplesDir, file), 'utf8'))]),
);

const byName = (workflow, name) => {
	const node = workflow.nodes.find((entry) => entry.name === name);
	assert.ok(node, `node "${name}" exists`);
	return node;
};

/** Resolves the only expression form the examples use: ={{ $json.field }}. */
function resolve(value, input) {
	if (typeof value === 'string' && value.startsWith('=')) {
		const match = /^=\{\{\s*\$json\.([A-Za-z_]\w*)\s*\}\}$/.exec(value);
		assert.ok(match, `unsupported expression ${value}`);
		return input[match[1]];
	}
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, resolve(entry, input)]),
		);
	}
	return value;
}

/** The request a TrendsFast example node would send for this input item. */
function requestFor(node, input) {
	const parameters = resolve(node.parameters, input);
	const values = effectiveParameters(properties, parameters);
	const read = (name, fallback) => {
		const shown = properties.some(
			(property) => property.name === name && isDisplayed(property, values),
		);
		if (shown && values[name] !== undefined) return values[name];
		return fallback;
	};
	const call = transport.planCall(parameters.resource, parameters.operation, read);
	return {
		call,
		options: transport.httpRequestOptions(call, call.charge ? REQUEST_ID : undefined),
	};
}

/**
 * Runs a Code node ("Run Once for All Items") with n8n's $input and $() bindings. The code is
 * the JavaScript committed in this package's own examples/, never outside input.
 */
function runCode(node, input, others = {}) {
	const $input = { first: () => ({ json: input }), all: () => [{ json: input }] };
	const $ = (name) => {
		assert.ok(name in others, `test supplies the output of "${name}"`);
		return { first: () => ({ json: others[name] }) };
	};
	return new Function('$input', '$', node.parameters.jsCode)($input, $);
}

test('there are importable example workflows', () => {
	assert.deepEqual(files.sort(), [
		'monday-trending-with-recovery.json',
		'weekly-customer-conversations-digest.json',
	]);
});

for (const [file, workflow] of Object.entries(workflows)) {
	test(`${file}: inactive, with no credentials, recipients or secrets inside`, () => {
		assert.equal(workflow.active, false);
		const text = JSON.stringify(workflow);
		assert.doesNotMatch(
			text,
			/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
			'no email addresses',
		);
		assert.doesNotMatch(text, /tf_(live|test)_/, 'no API keys');
		assert.doesNotMatch(text, /Bearer /, 'no authorization headers');
		for (const node of workflow.nodes) {
			assert.equal(node.credentials, undefined, `${node.name} has no credential`);
			assert.ok(
				!/email|slack|gmail|telegram|webhook/i.test(node.type),
				`${node.name} sends nothing`,
			);
		}
		const names = new Set(workflow.nodes.map((node) => node.name));
		assert.equal(names.size, workflow.nodes.length, 'node names are unique');
		assert.equal(new Set(workflow.nodes.map((node) => node.id)).size, workflow.nodes.length);
		for (const [source, outputs] of Object.entries(workflow.connections)) {
			assert.ok(names.has(source), `${source} exists`);
			for (const lane of outputs.main)
				for (const edge of lane) assert.ok(names.has(edge.node), edge.node);
		}
	});

	test(`${file}: every TrendsFast node is valid for the node and never retried automatically`, () => {
		const nodes = workflow.nodes.filter((node) => node.type === TRENDSFAST);
		assert.ok(nodes.length >= 2);
		for (const node of nodes) {
			assert.equal(node.typeVersion, 1);
			assert.equal(node.retryOnFail, false, `${node.name} must not retry a paid call`);
			const values = effectiveParameters(properties, node.parameters);
			for (const [key, value] of Object.entries(node.parameters)) {
				const property = properties.find(
					(entry) => entry.name === key && isDisplayed(entry, values),
				);
				assert.ok(property, `${node.name}: "${key}" is a parameter of this operation`);
				if (property.type === 'collection') {
					const allowed = property.options.map((option) => option.name);
					for (const option of Object.keys(value))
						assert.ok(allowed.includes(option), `${key}.${option}`);
				}
			}
		}
	});
}

test('weekly digest: reads the saved brand and spends nothing without one or above Max Credits', () => {
	const workflow = workflows['weekly-customer-conversations-digest.json'];
	assert.ok(
		!workflow.nodes.some((node) => node.type === 'n8n-nodes-base.set'),
		'no hand-typed brand: Customers collects fresh only for the saved brand context',
	);
	assert.deepEqual(
		workflow.connections['Every Monday at 08:00'].main[0][0].node,
		'Get brand context (free)',
	);

	const contextNode = byName(workflow, 'Get brand context (free)');
	const { call: contextCall, options: contextRequest } = requestFor(contextNode, {});
	assert.equal(contextCall.charge, undefined, 'reading the brand context is free');
	assert.equal(contextRequest.method, 'GET');
	assert.equal(contextRequest.url, '/v3/trends/context');

	const { options: quoteRequest } = requestFor(
		byName(workflow, 'Get the Customers price (free)'),
		{},
	);
	assert.equal(quoteRequest.method, 'GET');
	assert.deepEqual(quoteRequest.qs, { operation: 'niche', product: 'customers' });

	const check = byName(workflow, 'Check context and price');
	const quote = {
		version: 'trends-credit-quote-v3',
		operation: 'niche',
		credits: 10,
		max_credits: 10,
		catalog_version: 'fixture-catalog',
		new_research: false,
		available: true,
	};
	const confirmed = {
		version: 'trend-context-v3',
		context: { kind: 'CONFIRMED_CONTEXT', context_id: CONTEXT_ID, revision: 3, fields: [] },
	};
	assert.deepEqual(schemaErrors(quoteSchema, quote), [], 'the fixture is a valid quote');
	const brand = (context) => ({ 'Get brand context (free)': context });
	for (const missing of [
		{ version: 'trend-context-v3', context: null },
		{
			version: 'trend-context-v3',
			context: { kind: 'TEMPORARY_INPUT', context_id: null, revision: null, fields: [] },
		},
	]) {
		assert.throws(() => runCode(check, quote, brand(missing)), /No saved brand context yet/);
	}
	assert.throws(
		() => runCode(check, { ...quote, credits: 12 }, brand(confirmed)),
		/above this workflow's Max Credits of 10/,
	);
	assert.throws(
		() => runCode(check, { ...quote, available: false }, brand(confirmed)),
		/not available/,
	);
	assert.deepEqual(runCode(check, quote, brand(confirmed)), [{ json: { context_id: CONTEXT_ID } }]);

	const run = byName(workflow, 'Find customer conversations (10 credits)');
	assert.equal(run.parameters.brandSource, 'context');
	assert.equal(run.parameters.maxCredits, 10, "the guard's Max Credits matches the run's");
	const { options } = requestFor(run, { context_id: CONTEXT_ID });
	assert.equal(options.url, '/v3/trends/niche');
	assert.equal(options.body.max_credits, 10);
	assert.deepEqual(options.body.input, { product: 'customers', context_id: CONTEXT_ID });
	assert.deepEqual(schemaErrors(requestBodySchema('POST', '/v3/trends/niche'), options.body), []);
});

test('weekly digest: formats where customers talked, with links and the request ID', () => {
	const workflow = workflows['weekly-customer-conversations-digest.json'];
	const format = byName(workflow, 'Format the digest');
	const result = fixture('customers-result.json');
	const [{ json }] = runCode(format, result);
	assert.equal(json.request_id, result.request_id);
	assert.equal(json.result_id, result.result_id);
	assert.match(json.text, /^Where your customers talked \(week of \d{4}-\d{2}-\d{2}\)/);
	assert.match(json.text, /REDDIT r\/fixture_freelance: 1/);
	for (const item of result.data.items) {
		assert.ok(json.text.includes(item.current_observation.title));
		assert.ok(json.text.includes(item.entity.original_url));
	}
	assert.match(json.text, /10 credits\./);

	const empty = structuredClone(result);
	empty.data.items = [];
	empty.usage.this_request_credits = 0;
	assert.match(
		runCode(format, empty)[0].json.text,
		/No conversations matched this week\. An empty result costs 0 credits\./,
	);
});

test('Monday trending: uses the saved context, recovers lost answers for free and never resends', () => {
	const workflow = workflows['monday-trending-with-recovery.json'];
	const useContext = byName(workflow, 'Use the saved context');
	const confirmed = {
		version: 'trend-context-v3',
		context: { kind: 'CONFIRMED_CONTEXT', context_id: CONTEXT_ID, revision: 3, fields: [] },
	};
	assert.deepEqual(runCode(useContext, confirmed), [{ json: { context_id: CONTEXT_ID } }]);
	assert.throws(
		() => runCode(useContext, { version: 'trend-context-v3', context: null }),
		/No confirmed brand context/,
	);

	const trending = byName(workflow, 'Trending for my brand (25 credits)');
	assert.equal(trending.onError, 'continueErrorOutput');
	const { options } = requestFor(trending, { context_id: CONTEXT_ID });
	assert.deepEqual(options.body.input, { product: 'niche', context_id: CONTEXT_ID });
	assert.equal(options.body.max_credits, 25);
	assert.deepEqual(schemaErrors(requestBodySchema('POST', '/v3/trends/niche'), options.body), []);

	const outputs = workflow.connections['Trending for my brand (25 credits)'].main;
	assert.equal(outputs[0][0].node, 'Top five topics');
	assert.equal(outputs[1][0].node, 'Decide whether to recover');

	const decide = byName(workflow, 'Decide whether to recover');
	for (const failed of [
		{ error: 'No answer arrived', request_id: REQUEST_ID },
		{ error: 'TrendsFast could not confirm', request_id: REQUEST_ID, http_status: 503 },
		{ error: 'TrendsFast has not finished', request_id: REQUEST_ID, http_status: 409 },
	]) {
		assert.deepEqual(runCode(decide, failed), [{ json: { request_id: REQUEST_ID } }]);
	}
	assert.throws(
		() =>
			runCode(decide, {
				error: 'TrendsFast did not start',
				request_id: REQUEST_ID,
				http_status: 402,
			}),
		/nothing to recover/,
	);

	const recover = byName(workflow, 'Recover by request ID (free)');
	const { call, options: recovery } = requestFor(recover, { request_id: REQUEST_ID });
	assert.equal(call.charge, undefined, 'recovery is a free read');
	assert.equal(recovery.method, 'GET');
	assert.equal(recovery.url, `/v3/trends/requests/${REQUEST_ID}`);

	const top = byName(workflow, 'Top five topics');
	const result = fixture('customers-result.json');
	result.data.items[0].topic_history = null;
	const [{ json }] = runCode(top, result);
	assert.equal(json.text.split('\n').filter((line) => /^\d\./.test(line)).length, 3);
	assert.equal(json.request_id, result.request_id);
});
