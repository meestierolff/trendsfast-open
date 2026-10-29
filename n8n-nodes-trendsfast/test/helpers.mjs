// Shared test helpers. Tests run offline against the built package in dist/ and never open a
// socket: every HTTP call goes to a fake n8n request helper that records what would be sent.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export function readJson(relativePath) {
	return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

export function fromDist(relativePath) {
	const absolute = fileURLToPath(new URL(`../dist/${relativePath}`, import.meta.url));
	if (!existsSync(absolute)) throw new Error(`Missing ${absolute}: run "npm run build" first`);
	return require(absolute);
}

export const workflow = require('n8n-workflow');
export const openapi = readJson('test/fixtures/openapi-v3.json');

export function loadNode() {
	const { TrendsFast } = fromDist('nodes/TrendsFast/TrendsFast.node.js');
	return new TrendsFast();
}

export function loadCredential() {
	const { TrendsFastApi } = fromDist('credentials/TrendsFastApi.credentials.js');
	return new TrendsFastApi();
}

export const transport = {
	...fromDist('nodes/TrendsFast/transport/planCall.js'),
	...fromDist('nodes/TrendsFast/transport/requestId.js'),
	...fromDist('nodes/TrendsFast/transport/outcome.js'),
};

export const catalog = fromDist('nodes/TrendsFast/catalog.js');

// --- OpenAPI ------------------------------------------------------------------------------

const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi', components: openapi.components });

/** Validates `value` against an OpenAPI component or an inline schema; returns the errors. */
export function schemaErrors(schema, value) {
	const validate =
		typeof schema === 'string'
			? (ajv.getSchema(`openapi#/components/schemas/${schema}`) ??
				ajv.compile({ $ref: `openapi#/components/schemas/${schema}` }))
			: ajv.compile(schema);
	return validate(value)
		? []
		: validate.errors.map((error) => `${error.instancePath} ${error.message}`);
}

/** The OpenAPI path template a concrete path belongs to, such as /v3/trends/results/{id}. */
export function openapiPath(path) {
	return Object.keys(openapi.paths).find((template) =>
		new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path),
	);
}

export function openapiOperation(method, path) {
	const template = openapiPath(path);
	return template ? openapi.paths[template][method.toLowerCase()] : undefined;
}

export function requestBodySchema(method, path) {
	return openapiOperation(method, path)?.requestBody?.content?.['application/json']?.schema;
}

// --- A fake n8n execution context ----------------------------------------------------------

/** Whether a property is shown for these parameter values (n8n's displayOptions semantics). */
export function isDisplayed(property, values) {
	const { show, hide } = property.displayOptions ?? {};
	for (const [key, allowed] of Object.entries(show ?? {})) {
		if (!allowed.includes(values[key])) return false;
	}
	for (const [key, blocked] of Object.entries(hide ?? {})) {
		if (blocked.includes(values[key])) return false;
	}
	return true;
}

/** Parameter values as n8n holds them at run time: what is set, plus each shown default. */
export function effectiveParameters(properties, parameters) {
	const values = { ...parameters };
	for (let pass = 0; pass < 4; pass++) {
		for (const property of properties) {
			if (values[property.name] !== undefined) continue;
			if (isDisplayed(property, values)) values[property.name] = structuredClone(property.default);
		}
	}
	return values;
}

/**
 * Builds the `this` an n8n node's execute() receives. `parameters` may be one object or a
 * function of the item index. `respond(options, callNumber)` answers each HTTP request.
 */
export function makeContext({
	node,
	parameters,
	items = [{ json: {} }],
	executionId = 'execution-1',
	instanceId = 'instance-1',
	nodeId = 'node-1',
	continueOnFail = false,
	respond = () => ({ statusCode: 200, body: {} }),
}) {
	const calls = [];
	const properties = node.description.properties;
	const parametersFor = (itemIndex) =>
		typeof parameters === 'function' ? parameters(itemIndex) : parameters;
	const context = {
		getInputData: () => items,
		getNodeParameter(name, itemIndex, fallback) {
			const raw = parametersFor(itemIndex);
			const values = effectiveParameters(properties, raw);
			const shown = properties.some(
				(property) => property.name === name && isDisplayed(property, values),
			);
			if (shown && values[name] !== undefined) return values[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Could not get parameter "${name}"`);
		},
		getExecutionId: () => executionId,
		getInstanceId: () => instanceId,
		getNode: () => ({
			id: nodeId,
			name: 'TrendsFast',
			type: 'n8n-nodes-trendsfast.trendsFast',
			typeVersion: 1,
			position: [0, 0],
			parameters: parametersFor(0),
		}),
		continueOnFail: () => continueOnFail,
		helpers: {
			async httpRequestWithAuthentication(credentialType, options) {
				calls.push({ credentialType, options: structuredClone(options), boundTo: this });
				return respond(options, calls.length);
			},
		},
	};
	return { context, calls };
}

/** A deep copy of a JSON fixture, so a test can never change another test's data. */
export function fixture(relativePath) {
	return structuredClone(readJson(`test/fixtures/${relativePath}`));
}
