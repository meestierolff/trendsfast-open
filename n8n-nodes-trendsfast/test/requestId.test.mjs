import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openapi, transport } from './helpers.mjs';

const { uuidV5, resolveRequestId, UUID_PATTERN, REQUEST_ID_NAMESPACE } = transport;

const identity = { instanceId: 'instance-1', executionId: '41', nodeId: 'node-1' };
const serverPattern = new RegExp(
	openapi.paths['/v3/trends/niche'].post.requestBody.content['application/json'].schema.properties
		.request_id.pattern,
);

test('uuidV5 matches the RFC 9562 test vector', () => {
	// RFC 9562 appendix: UUIDv5 of "www.example.com" in the DNS namespace.
	assert.equal(
		uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'),
		'2ed6657d-e927-568b-95e1-2665a8aea6a2',
	);
});

test('a derived request ID is a version 5 UUID that TrendsFast accepts', () => {
	const id = resolveRequestId('', identity, 'fingerprint-a');
	assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	assert.match(id, UUID_PATTERN);
	assert.match(id, serverPattern);
	assert.match(REQUEST_ID_NAMESPACE, UUID_PATTERN);
});

test('the same request in the same execution always gets the same ID', () => {
	const first = resolveRequestId('', identity, 'fingerprint-a');
	assert.equal(resolveRequestId('', { ...identity }, 'fingerprint-a'), first);
	assert.equal(resolveRequestId('   ', identity, 'fingerprint-a'), first);
});

test('a new execution, node, instance or request gets a new ID', () => {
	const first = resolveRequestId('', identity, 'fingerprint-a');
	const variants = [
		resolveRequestId('', { ...identity, executionId: '42' }, 'fingerprint-a'),
		resolveRequestId('', { ...identity, nodeId: 'node-2' }, 'fingerprint-a'),
		resolveRequestId('', { ...identity, instanceId: 'instance-2' }, 'fingerprint-a'),
		resolveRequestId('', identity, 'fingerprint-b'),
	];
	assert.equal(new Set([first, ...variants]).size, 5);
});

test('a supplied ID is used exactly as given and must be a UUID', () => {
	const supplied = '0D6F3C3E-5B8A-4D6E-9A43-2F1C7B9E8A10';
	assert.equal(resolveRequestId(` ${supplied} `, identity, 'x'), supplied);
	for (const bad of [
		'abc',
		'0d6f3c3e-5b8a-4d6e-9a43',
		'0d6f3c3e-5b8a-0d6e-9a43-2f1c7b9e8a10',
		'{{ $json.id }}',
	]) {
		assert.throws(
			() => resolveRequestId(bad, identity, 'x'),
			(error) =>
				error.name === 'TrendsFastInputError' && /'Request ID' must be a UUID/.test(error.message),
		);
	}
});

test('without an execution ID the ID is random, made once per call', () => {
	let made = 0;
	const random = () => {
		made += 1;
		return 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
	};
	assert.equal(
		resolveRequestId('', undefined, 'x', random),
		'f47ac10b-58cc-4372-a567-0e02b2c3d479',
	);
	assert.equal(
		resolveRequestId('', { ...identity, executionId: '' }, 'x', random),
		'f47ac10b-58cc-4372-a567-0e02b2c3d479',
	);
	assert.equal(made, 2);
	assert.match(resolveRequestId('', undefined, 'x'), UUID_PATTERN);
});
