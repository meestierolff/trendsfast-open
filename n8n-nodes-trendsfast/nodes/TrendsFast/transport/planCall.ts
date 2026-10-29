import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import {
	ASK_CREDITS,
	CATEGORY_CHOICES,
	CONTENT_TYPE_CHOICES,
	ENDPOINTS,
	type Endpoint,
	findProduct,
	GLOBAL_TRENDS_CREDITS,
	MAX_CREDITS_CEILING,
	NICHE_READ_CREDITS,
	NICHE_TERM_FIELDS,
	PAID_TIMEOUT_MS,
	PLATFORM_CHOICES,
	READ_TIMEOUT_MS,
	SIGNAL_CHOICES,
	TERM_MAX_LENGTH,
	TRENDSFAST_BASE_URL,
	type Choice,
} from '../catalog';
import { TrendsFastInputError } from './inputError';
import { UUID_PATTERN } from './requestId';

/** Reads one node parameter for the current item; `fallback` is returned when it is hidden. */
export type ReadParameter = (name: string, fallback?: unknown) => unknown;

/** The spending half of a paid call: everything in its body except the request ID. */
export interface PlannedCharge {
	maxCredits: number;
	suppliedRequestId: string;
	input: IDataObject;
}

export interface PlannedCall {
	/** `resource.operation`, for messages and tests. */
	key: string;
	/** What the call does, in words, for messages. */
	label: string;
	endpoint: Endpoint;
	/** The concrete path, with any ID filled in. */
	path: string;
	qs?: IDataObject;
	charge?: PlannedCharge;
}

const MAX_CURSOR_LENGTH = 512;

function asText(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return '';
}

function requiredUuid(value: unknown, field: string, hint: string): string {
	const text = asText(value);
	if (!text) throw new TrendsFastInputError(`'${field}' is empty`, hint);
	if (!UUID_PATTERN.test(text)) throw new TrendsFastInputError(`'${field}' must be a UUID`, hint);
	return text;
}

function optionalUuid(value: unknown, field: string, hint: string): string | undefined {
	return asText(value) ? requiredUuid(value, field, hint) : undefined;
}

function boundedText(value: unknown, field: string, min: number, max: number): string {
	const text = asText(value);
	if (text.length < min || text.length > max) {
		throw new TrendsFastInputError(
			`'${field}' must be ${min} to ${max.toLocaleString('en-US')} characters long`,
			text.length
				? `It is ${text.length.toLocaleString('en-US')} characters now.`
				: 'It is empty now.',
		);
	}
	return text;
}

function wholeNumber(value: unknown, field: string, min: number, max: number): number {
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
		throw new TrendsFastInputError(`'${field}' must be a whole number from ${min} to ${max}`);
	}
	return number;
}

/** An unset Max Credits falls back to the price, which is also the field's default. */
function maxCredits(value: unknown, price: number): number {
	if (value === undefined || value === null || value === '') return price;
	return wholeNumber(value, 'Max Credits', 0, MAX_CREDITS_CEILING);
}

/** Splits a comma- or line-separated list, trimming and dropping empty and repeated terms. */
export function parseTerms(value: unknown, field: string, max: number): string[] {
	const raw = Array.isArray(value) ? value.map(asText) : asText(value).split(/[,\n]/);
	const terms: string[] = [];
	for (const entry of raw) {
		const term = entry.trim();
		if (term && !terms.includes(term)) terms.push(term);
	}
	if (terms.length > max) {
		throw new TrendsFastInputError(`'${field}' has ${terms.length} entries; the most is ${max}`);
	}
	const long = terms.find((term) => term.length > TERM_MAX_LENGTH);
	if (long) {
		throw new TrendsFastInputError(
			`An entry in '${field}' is longer than ${TERM_MAX_LENGTH} characters`,
			`Shorten "${long.slice(0, 40)}…".`,
		);
	}
	return terms;
}

function choiceList(
	value: unknown,
	field: string,
	allowed: readonly Choice[],
	max: number,
): string[] {
	const values = Array.isArray(value)
		? value.map(asText).filter(Boolean)
		: asText(value)
			? asText(value)
					.split(',')
					.map((entry) => entry.trim())
			: [];
	const unique = [...new Set(values)];
	const known = new Set(allowed.map((choice) => choice.value));
	const unknown = unique.find((entry) => !known.has(entry));
	if (unknown) throw new TrendsFastInputError(`'${field}' has an unknown value: ${unknown}`);
	if (unique.length > max)
		throw new TrendsFastInputError(`'${field}' allows at most ${max} values`);
	return unique;
}

function parseUrl(candidate: string): URL | undefined {
	try {
		return new URL(candidate);
	} catch {
		return undefined;
	}
}

function websiteUrl(value: unknown): string | undefined {
	const text = asText(value);
	if (!text) return undefined;
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
	const parsed = parseUrl(candidate);
	if (!parsed) {
		throw new TrendsFastInputError(
			`'Website URL' is not a valid URL`,
			'Use a full address such as https://example.com.',
		);
	}
	// TrendsFast accepts a public HTTPS address: no other scheme, no credentials, no port.
	if (
		parsed.protocol !== 'https:' ||
		parsed.username ||
		parsed.password ||
		parsed.port ||
		candidate.length > 2048
	) {
		throw new TrendsFastInputError(
			`'Website URL' must be a public https address of at most 2,048 characters, such as https://example.com`,
		);
	}
	return candidate;
}

/** `filters` for a niche or global read: only the fields the user set, in API names. */
function readFilters(options: IDataObject, allowChoices: boolean): IDataObject {
	const filters: IDataObject = {};
	if (allowChoices) {
		const lists: Array<[string, string, readonly Choice[], number, string]> = [
			['platforms', 'platforms', PLATFORM_CHOICES, 11, 'Platforms'],
			['contentTypes', 'content_types', CONTENT_TYPE_CHOICES, 4, 'Content Types'],
			['categories', 'categories', CATEGORY_CHOICES, 10, 'Categories'],
			['signals', 'signals', SIGNAL_CHOICES, 8, 'Signals'],
		];
		for (const [param, api, allowed, max, field] of lists) {
			const values = choiceList(options[param], field, allowed, max);
			if (values.length) filters[api] = values;
		}
		const country = asText(options.country).toUpperCase();
		if (country) {
			if (!/^[A-Z]{2}$/.test(country))
				throw new TrendsFastInputError(`'Country' must be a two-letter code such as US`);
			filters.country = country;
		}
		const language = asText(options.language);
		if (language) {
			if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) {
				throw new TrendsFastInputError(`'Language' must look like en or en-US`);
			}
			filters.language = language;
		}
	}
	if (options.lookbackHours !== undefined && options.lookbackHours !== '') {
		filters.lookback_hours = wholeNumber(options.lookbackHours, 'Lookback Hours', 1, 720);
	}
	if (options.maxItems !== undefined && options.maxItems !== '') {
		filters.limit = wholeNumber(options.maxItems, 'Max Items', 1, 100);
	}
	return filters;
}

function readNiche(read: ReadParameter): IDataObject {
	const niche: IDataObject = {
		description: boundedText(read('brandDescription', ''), 'Brand Description', 3, 2000),
	};
	const url = websiteUrl(read('websiteUrl', ''));
	if (url) niche.url = url;
	const details = (read('brandDetails', {}) ?? {}) as IDataObject;
	for (const field of NICHE_TERM_FIELDS) {
		const terms = parseTerms(details[field.param], field.displayName, field.max);
		if (terms.length) niche[field.api] = terms;
	}
	const market = asText(details.market);
	if (market) {
		if (market.length > 100)
			throw new TrendsFastInputError(`'Market' must be at most 100 characters`);
		niche.market = market;
	}
	const language = asText(details.language);
	if (language) {
		if (language.length > 20)
			throw new TrendsFastInputError(`'Language' must be at most 20 characters`);
		niche.language = language;
	}
	const platforms = choiceList(details.platforms, 'Platforms', PLATFORM_CHOICES, 11);
	if (platforms.length) niche.platforms = platforms;
	return niche;
}

function cursorQuery(read: ReadParameter): IDataObject | undefined {
	const options = (read('options', {}) ?? {}) as IDataObject;
	const cursor = asText(options.cursor);
	if (!cursor) return undefined;
	if (cursor.length > MAX_CURSOR_LENGTH) {
		throw new TrendsFastInputError(`'Cursor' must be at most ${MAX_CURSOR_LENGTH} characters`);
	}
	return { cursor };
}

const CONTEXT_HINT =
	"Get it for free with Account > Get Context; it is 'context.context_id' in that output.";

/**
 * Turns the node parameters of one item into one TrendsFast call. Everything the API would
 * reject is checked here first, so a mistyped field never reaches a paid endpoint.
 */
export function planCall(resource: string, operation: string, read: ReadParameter): PlannedCall {
	const key = `${resource}.${operation}`;
	switch (key) {
		case 'product.run': {
			const product = findProduct(read('product'));
			if (!product) throw new TrendsFastInputError(`'Product' must be one of the five products`);
			const savedContext = read('brandSource', 'context') !== 'niche';
			const input: IDataObject = {};
			if (savedContext) {
				// The product collects the brand's own sources fresh first, at its own price.
				input.product = product.id;
				input.context_id = requiredUuid(read('contextId', ''), 'Context ID', CONTEXT_HINT);
			} else {
				// TrendsFast never collects for a typed niche, and a product would still be charged
				// its full price, so this is a plain niche read through the product's lens instead.
				input.niche = readNiche(read);
			}
			const options = (read('options', {}) ?? {}) as IDataObject;
			const chosen = choiceList(options.contentTypes, 'Content Types', CONTENT_TYPE_CHOICES, 4);
			const contentTypes = chosen.length ? chosen : savedContext ? [] : [...(product.lens ?? [])];
			const filters: IDataObject = {
				...(contentTypes.length ? { content_types: contentTypes } : {}),
				...readFilters(options, false),
			};
			if (Object.keys(filters).length) input.filters = filters;
			if (typeof options.includeAdjacent === 'boolean')
				input.include_adjacent = options.includeAdjacent;
			if (typeof options.includeGlobal === 'boolean') input.include_global = options.includeGlobal;
			const price = savedContext ? product.credits : NICHE_READ_CREDITS;
			return {
				key,
				label: savedContext ? `the ${product.name} run` : `the ${product.name} read`,
				endpoint: ENDPOINTS.niche,
				path: ENDPOINTS.niche.path,
				charge: {
					maxCredits: maxCredits(read('maxCredits', price), price),
					suppliedRequestId: asText(read('requestId', '')),
					input,
				},
			};
		}
		case 'product.getQuote': {
			const product = findProduct(read('product'));
			if (!product) throw new TrendsFastInputError(`'Product' must be one of the five products`);
			return {
				key,
				label: `the ${product.name} quote`,
				endpoint: ENDPOINTS.quote,
				path: ENDPOINTS.quote.path,
				qs: { operation: 'niche', product: product.id },
			};
		}
		case 'globalTrend.query': {
			const filters = (read('filters', {}) ?? {}) as IDataObject;
			return {
				key,
				label: 'the global trends query',
				endpoint: ENDPOINTS.global,
				path: ENDPOINTS.global.path,
				charge: {
					maxCredits: maxCredits(read('maxCredits', GLOBAL_TRENDS_CREDITS), GLOBAL_TRENDS_CREDITS),
					suppliedRequestId: asText(read('requestId', '')),
					input: readFilters(filters, true),
				},
			};
		}
		case 'question.ask': {
			const input: IDataObject = {
				question: boundedText(read('question', ''), 'Question', 3, 1000),
			};
			const contextId = optionalUuid(read('contextId', ''), 'Context ID', CONTEXT_HINT);
			if (contextId) input.context_id = contextId;
			return {
				key,
				label: 'the question',
				endpoint: ENDPOINTS.ask,
				path: ENDPOINTS.ask.path,
				charge: {
					maxCredits: maxCredits(read('maxCredits', ASK_CREDITS), ASK_CREDITS),
					suppliedRequestId: asText(read('requestId', '')),
					input,
				},
			};
		}
		case 'result.get': {
			const id = requiredUuid(
				read('resultId', ''),
				'Result ID',
				"Use the 'result_id' of an earlier output, or one from Account > Get History.",
			);
			return {
				key,
				label: 'the result read',
				endpoint: ENDPOINTS.result,
				path: ENDPOINTS.result.path.replace('{id}', id),
				qs: cursorQuery(read),
			};
		}
		case 'request.get': {
			const id = requiredUuid(
				read('requestId', ''),
				'Request ID',
				"Use the 'request_id' you sent, or the one in a failed item's output.",
			);
			return {
				key,
				label: 'the request lookup',
				endpoint: ENDPOINTS.request,
				path: ENDPOINTS.request.path.replace('{id}', id),
			};
		}
		case 'account.getWallet':
			return {
				key,
				label: 'the wallet read',
				endpoint: ENDPOINTS.wallet,
				path: ENDPOINTS.wallet.path,
			};
		case 'account.getContext':
			return {
				key,
				label: 'the context read',
				endpoint: ENDPOINTS.context,
				path: ENDPOINTS.context.path,
			};
		case 'account.getHistory':
			return {
				key,
				label: 'the history read',
				endpoint: ENDPOINTS.history,
				path: ENDPOINTS.history.path,
				qs: cursorQuery(read),
			};
		default:
			throw new TrendsFastInputError(
				`The operation '${operation}' is not available for '${resource}'`,
			);
	}
}

/** The JSON body of a paid call: exactly `request_id`, `max_credits` and `input`. */
export function requestBody(charge: PlannedCharge, requestId: string): IDataObject {
	return { request_id: requestId, max_credits: charge.maxCredits, input: charge.input };
}

/** Everything a paid call sends except its request ID, so a derived ID follows the request. */
export function fingerprint(call: PlannedCall): string {
	return JSON.stringify([
		call.endpoint.method,
		call.path,
		call.charge
			? { max_credits: call.charge.maxCredits, input: call.charge.input }
			: (call.qs ?? null),
	]);
}

/**
 * The options handed to n8n's authenticated request helper. Redirects are never followed and
 * every HTTP status comes back as a value, so the node itself decides what an answer means and
 * nothing in between resends a paid request.
 */
export function httpRequestOptions(call: PlannedCall, requestId?: string): IHttpRequestOptions {
	const options: IHttpRequestOptions = {
		method: call.endpoint.method,
		baseURL: TRENDSFAST_BASE_URL,
		url: call.path,
		headers: { Accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		disableFollowRedirect: true,
		timeout: call.endpoint.paid ? PAID_TIMEOUT_MS : READ_TIMEOUT_MS,
	};
	if (call.qs && Object.keys(call.qs).length) options.qs = call.qs;
	if (call.charge) {
		if (!requestId) throw new TrendsFastInputError('A paid call needs a request ID');
		options.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
		options.body = requestBody(call.charge, requestId);
	}
	return options;
}
