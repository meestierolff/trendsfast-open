import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { fixture, loadNode, makeContext, schemaErrors, transport, workflow } from './helpers.mjs';

const { NodeApiError, NodeOperationError } = workflow;
const node = loadNode();

const CONTEXT_ID = '3f0c2a51-8d4b-4c1e-9f7a-6b2d5e8c1a90';
const RUN = { resource: 'product', operation: 'run', product: 'customers', contextId: CONTEXT_ID };
const ok = (body) => () => ({ statusCode: 200, body, headers: {} });

async function execute(options) {
	const { context, calls } = makeContext({ node, ...options });
	const output = await node.execute.call(context);
	return { output: output[0], calls };
}

async function executeFailure(options) {
	const { context, calls } = makeContext({ node, ...options });
	const error = await node.execute.call(context).then(
		() => assert.fail('execute() should have stopped'),
		(caught) => caught,
	);
	return { error, calls };
}

test('a Run returns the TrendsFast JSON exactly as sent', async () => {
	const body = fixture('customers-result.json');
	assert.deepEqual(
		schemaErrors('TrendsApiV3Response', body),
		[],
		'the fixture is a valid response',
	);
	const { output, calls } = await execute({ parameters: RUN, respond: ok(structuredClone(body)) });
	assert.equal(output.length, 1);
	assert.deepEqual(output[0].json, body);
	assert.deepEqual(output[0].pairedItem, { item: 0 });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].credentialType, 'trendsFastApi');
	assert.equal(calls[0].options.method, 'POST');
	assert.equal(calls[0].options.url, '/v3/trends/niche');
});

test('a website-and-description Run sends a 3-credit niche read with no product', async () => {
	const { calls } = await execute({
		parameters: {
			resource: 'product',
			operation: 'run',
			product: 'search',
			brandSource: 'niche',
			brandDescription: 'Invoicing software for freelance designers',
		},
		respond: ok({}),
	});
	assert.equal(calls.length, 1);
	const { body } = calls[0].options;
	assert.equal(body.input.product, undefined);
	assert.deepEqual(body.input.niche, { description: 'Invoicing software for freelance designers' });
	assert.deepEqual(body.input.filters, { content_types: ['SEARCH'] });
	assert.equal(body.max_credits, 3);
	assert.match(body.request_id, transport.UUID_PATTERN);
});

test('an empty Request ID is derived once per request, stable within one execution', async () => {
	const first = await execute({ parameters: RUN, respond: ok({}) });
	const again = await execute({ parameters: RUN, respond: ok({}) });
	const nextRun = await execute({ parameters: RUN, executionId: 'execution-2', respond: ok({}) });
	const id = first.calls[0].options.body.request_id;
	assert.match(id, transport.UUID_PATTERN);
	assert.equal(
		again.calls[0].options.body.request_id,
		id,
		"n8n's Retry On Fail would resend this same ID",
	);
	assert.notEqual(nextRun.calls[0].options.body.request_id, id, 'a new execution is a new request');
	const call = transport.planCall(
		'product',
		'run',
		(name, fallback) =>
			({ ...RUN, brandSource: 'context', maxCredits: 10, requestId: '', options: {} })[name] ??
			fallback,
	);
	assert.equal(
		transport.resolveRequestId(
			'',
			{ instanceId: 'instance-1', executionId: 'execution-1', nodeId: 'node-1' },
			transport.fingerprint(call),
		),
		id,
	);
});

test('a supplied Request ID is sent as given', async () => {
	const requestId = '0d6f3c3e-5b8a-4d6e-9a43-2f1c7b9e8a10';
	const { calls } = await execute({ parameters: { ...RUN, requestId }, respond: ok({}) });
	assert.equal(calls[0].options.body.request_id, requestId);
});

test('every item gets its own request and its own request ID', async () => {
	const contexts = [CONTEXT_ID, '7c1e9a2b-4d3f-4a8e-b6c5-1f2e3d4c5b6a'];
	const { output, calls } = await execute({
		items: [{ json: {} }, { json: {} }],
		parameters: (itemIndex) => ({ ...RUN, contextId: contexts[itemIndex] }),
		respond: (options) => ({ statusCode: 200, body: { echoed: options.body.input.context_id } }),
	});
	assert.equal(calls.length, 2);
	assert.notEqual(calls[0].options.body.request_id, calls[1].options.body.request_id);
	assert.deepEqual(
		output.map((item) => [item.json.echoed, item.pairedItem.item]),
		[
			[contexts[0], 0],
			[contexts[1], 1],
		],
	);
});

test('a refused price stops the item, names the request ID and is not resent', async () => {
	const { error, calls } = await executeFailure({
		parameters: RUN,
		respond: () => ({
			statusCode: 402,
			body: { error: 'CREDIT_QUOTE_EXCEEDS_LIMIT', retryable: false },
		}),
	});
	const requestId = calls[0].options.body.request_id;
	assert.equal(calls.length, 1);
	assert.ok(error instanceof NodeApiError);
	assert.equal(error.httpCode, '402');
	assert.ok(error.message.includes(`request ID ${requestId}`), error.message);
	assert.match(error.message, /Max Credits/);
	assert.match(error.message, /\[Item 0\]$/);
	assert.match(error.description, /Nothing was charged/);
});

test('a lost response keeps the request ID, points to free recovery and is never resent', async () => {
	const { error, calls } = await executeFailure({
		parameters: RUN,
		respond: () => {
			throw Object.assign(new Error('connect ETIMEDOUT 76.76.21.21:443'), { code: 'ETIMEDOUT' });
		},
	});
	const requestId = calls[0].options.body.request_id;
	assert.equal(calls.length, 1);
	assert.ok(error instanceof NodeApiError);
	// n8n rewrites a message that names a socket code; the request ID must survive that.
	assert.ok(error.message.includes(`request ID ${requestId}`), error.message);
	assert.doesNotMatch(error.message, /Retry on Fail/i);
	assert.match(error.description, /Get by Request ID/);
	assert.match(error.description, /ETIMEDOUT/);
});

test('with Continue On Fail, a failed paid call keeps its request ID for a retry or recovery', async () => {
	const { output, calls } = await execute({
		parameters: RUN,
		continueOnFail: true,
		respond: () => ({
			statusCode: 503,
			body: {
				error: 'REQUEST_OUTCOME_UNCONFIRMED',
				retryable: false,
				recovery: 'Read the same request ID. Do not create a new request identity.',
			},
		}),
	});
	const requestId = calls[0].options.body.request_id;
	assert.equal(calls.length, 1);
	assert.equal(output.length, 1);
	const [item] = output;
	assert.equal(item.json.request_id, requestId);
	assert.equal(item.json.http_status, 503);
	assert.deepEqual(item.json.response, {
		error: 'REQUEST_OUTCOME_UNCONFIRMED',
		retryable: false,
		recovery: 'Read the same request ID. Do not create a new request identity.',
	});
	assert.match(item.json.error, /could not confirm the outcome/);
	assert.ok(item.error instanceof NodeApiError, 'n8n routes the item to the error output');
	assert.deepEqual(item.pairedItem, { item: 0 });
});

test('free reads send no body and no request ID', async () => {
	const wallet = { version: 'credit-wallet-v3', available: 90 };
	const { output, calls } = await execute({
		parameters: { resource: 'account', operation: 'getWallet' },
		respond: ok(wallet),
	});
	assert.deepEqual(output[0].json, wallet);
	assert.equal(calls[0].options.method, 'GET');
	assert.equal(calls[0].options.url, '/v3/trends/wallet');
	assert.equal(calls[0].options.body, undefined);

	const { calls: quoteCalls } = await execute({
		parameters: { resource: 'product', operation: 'getQuote', product: 'formats' },
		respond: ok({}),
	});
	assert.deepEqual(quoteCalls[0].options.qs, { operation: 'niche', product: 'formats' });
});

test('a free read that fails carries no request ID', async () => {
	const { output } = await execute({
		parameters: { resource: 'account', operation: 'getContext' },
		continueOnFail: true,
		respond: () => ({ statusCode: 401, body: { error: 'UNAUTHORIZED' } }),
	});
	assert.equal(output[0].json.request_id, undefined);
	assert.match(output[0].json.error, /did not accept the API key/);
});

test('input that would be rejected never reaches TrendsFast', async () => {
	const parameters = { ...RUN, brandSource: 'niche', brandDescription: 'ab' };
	const { error, calls } = await executeFailure({ parameters });
	assert.equal(calls.length, 0);
	assert.ok(error instanceof NodeOperationError);
	assert.match(error.message, /'Brand Description' must be 3 to 2,000 characters long \[Item 0\]/);
	assert.match(error.description, /Nothing was sent to TrendsFast/);

	const tolerant = await execute({ parameters, continueOnFail: true });
	assert.equal(tolerant.calls.length, 0);
	assert.match(tolerant.output[0].json.error, /'Brand Description'/);
	assert.ok(tolerant.output[0].error instanceof NodeOperationError);
});

test('a redirect is not followed and stops the paid item', async () => {
	const { error, calls } = await executeFailure({
		parameters: RUN,
		respond: () => ({
			statusCode: 308,
			body: '',
			headers: { location: 'https://elsewhere.example/' },
		}),
	});
	assert.equal(calls.length, 1);
	assert.match(error.message, /redirect \(HTTP 308\)/);
	assert.match(error.description, /Get by Request ID/);
});

test('a rate limit says how long to wait and to keep the same request ID', async () => {
	const { error } = await executeFailure({
		parameters: RUN,
		respond: () => ({
			statusCode: 429,
			body: { error: 'RATE_LIMITED', retryable: false },
			headers: { 'Retry-After': '60' },
		}),
	});
	assert.match(error.description, /Wait 60 seconds, then retry with the same Request ID/);
});

test('a reused request ID with new input explains how to proceed', async () => {
	const { error } = await executeFailure({
		parameters: { ...RUN, requestId: '0d6f3c3e-5b8a-4d6e-9a43-2f1c7b9e8a10' },
		respond: () => ({ statusCode: 409, body: { error: 'IDEMPOTENCY_CONFLICT', retryable: false } }),
	});
	assert.match(error.message, /already used for a different request/);
	assert.match(error.description, /Use a new Request ID for new input/);
});

test('the API key never appears in an error', async () => {
	const secret = 'tf_live_examplekey.examplesecret1234567890';
	const transportError = Object.assign(new Error('socket hang up'), {
		config: { headers: { Authorization: `Bearer ${secret}` } },
	});
	const { error } = await executeFailure({
		parameters: RUN,
		respond: () => {
			throw transportError;
		},
	});
	assert.ok(!inspect(error, { depth: 8 }).includes(secret));
	const tolerant = await execute({
		parameters: RUN,
		continueOnFail: true,
		respond: () => {
			throw transportError;
		},
	});
	assert.ok(!inspect(tolerant.output, { depth: 8 }).includes(secret));
});
