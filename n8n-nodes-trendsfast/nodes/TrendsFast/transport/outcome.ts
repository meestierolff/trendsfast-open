import type { IDataObject } from 'n8n-workflow';
import type { TrendsFastInputError } from './inputError';
import type { PlannedCall } from './planCall';

/** What n8n's request helper returns with `returnFullResponse`. */
export interface FullResponse {
	statusCode?: number;
	body?: unknown;
	headers?: IDataObject;
}

export interface Failure {
	ok: false;
	/** `input`: rejected before sending. `api`: TrendsFast answered, or no answer arrived. */
	kind: 'input' | 'api';
	message: string;
	description: string;
	httpCode?: string;
	/** Shown in n8n's error details. Only the status, the request ID and TrendsFast's own body. */
	details: IDataObject;
	/** The item an error-tolerant workflow receives instead of a result. */
	errorJson: IDataObject;
}

export type Outcome = { ok: true; json: IDataObject } | Failure;

const RECOVER =
	'Read it for free with Request > Get by Request ID before you send anything again; if TrendsFast has no record of it, send it again with the same Request ID. TrendsFast never charges one request ID twice.';

function isPlainObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerValue(headers: IDataObject | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
	return entry && (typeof entry[1] === 'string' || typeof entry[1] === 'number')
		? String(entry[1])
		: undefined;
}

function itemTag(itemIndex: number): string {
	return ` [Item ${itemIndex}]`;
}

function requestTag(requestId: string | undefined): string {
	return requestId ? ` (request ID ${requestId})` : '';
}

function failure(
	message: string,
	description: string,
	requestId: string | undefined,
	itemIndex: number,
	status?: number,
	body?: unknown,
): Failure {
	const fullMessage = `${message}${requestTag(requestId)}${itemTag(itemIndex)}`;
	const details: IDataObject = {};
	if (requestId) details.request_id = requestId;
	if (status !== undefined) details.http_status = status;
	if (isPlainObject(body)) details.response = body;
	return {
		ok: false,
		kind: 'api',
		message: fullMessage,
		description: description.trim(),
		httpCode: status === undefined ? undefined : String(status),
		details,
		errorJson: { error: fullMessage, ...details },
	};
}

function explainStatus(
	call: PlannedCall,
	status: number,
	body: unknown,
	headers: IDataObject | undefined,
): { message: string; description: string } {
	const paid = Boolean(call.charge);
	const apiError = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined;
	const recovery = isPlainObject(body) && typeof body.recovery === 'string' ? body.recovery : '';
	const code = apiError ? ` (${apiError})` : '';

	if (status >= 300 && status < 400) {
		return {
			message: `TrendsFast answered ${call.label} with a redirect (HTTP ${status}), which this node does not follow`,
			description: `Check that nothing between n8n and trendsfast.com rewrites the address. ${paid ? RECOVER : ''}`,
		};
	}
	switch (status) {
		case 400:
			return {
				message: `TrendsFast did not accept the input for ${call.label}${code}`,
				description: `Nothing was started. Check this step's fields against https://trendsfast.com/docs. ${recovery}`,
			};
		case 401:
			return {
				message: `TrendsFast did not accept the API key${code}`,
				description:
					'The key is missing, invalid, expired or revoked. Create a key under API keys in your TrendsFast dashboard and update the TrendsFast API credential. Nothing was started.',
			};
		case 402:
			return {
				message: `TrendsFast did not start ${call.label}: its price is above Max Credits, or the balance cannot cover it${code}`,
				description:
					'Nothing was charged. Product > Get Quote shows the current price for free. Raise Max Credits to at least the price, or add credits at https://trendsfast.com/pricing, then retry with the same Request ID.',
			};
		case 403:
			return {
				message: `The API key may not do ${call.label}${code}`,
				description: `This step needs a key with the ${call.endpoint.scope} scope. Create one under API keys in your TrendsFast dashboard. Nothing was started.`,
			};
		case 404:
			if (apiError === 'V3_DISABLED') {
				return {
					message: 'TrendsFast V3 is not available on this deployment',
					description: 'Nothing was started.',
				};
			}
			if (call.key === 'request.get') {
				return {
					message: `TrendsFast has no record of this request ID${code}`,
					description:
						'If you sent it moments ago, look again in a minute. Otherwise it never started, and you can send the same request again with the same Request ID.',
				};
			}
			return {
				message: `TrendsFast found nothing for ${call.label}${code}`,
				description: 'Check the ID. Results can be read again for 30 days.',
			};
		case 409:
			if (apiError === 'IDEMPOTENCY_CONFLICT') {
				return {
					message: 'This request ID was already used for a different request',
					description:
						'Use a new Request ID for new input, or leave Request ID empty. To see what the earlier request returned, read it for free with Request > Get by Request ID.',
				};
			}
			if (apiError === 'CONTEXT_NOT_CURRENT') {
				return {
					message: 'The context ID is not your current brand context (CONTEXT_NOT_CURRENT)',
					description:
						"Get the current one for free with Account > Get Context and use its 'context.context_id'.",
				};
			}
			return {
				message: `TrendsFast has not finished ${call.label}${code}`,
				description: `${recovery} ${paid ? RECOVER : 'Read it again in a minute; reads are free.'}`,
			};
		case 410:
			return {
				message: `The brand context or evidence behind ${call.label} is no longer available${code}`,
				description:
					'Refresh the brand in TrendsFast, then use the context ID from Account > Get Context.',
			};
		case 413:
			return {
				message: `The request for ${call.label} is larger than TrendsFast accepts${code}`,
				description:
					'A request body may be at most 32 KB. Shorten the brand description and details.',
			};
		case 429: {
			const wait = headerValue(headers, 'retry-after') ?? '60';
			return {
				message: `TrendsFast is limiting how fast this account can send requests${code}`,
				description: `Wait ${wait} seconds, then retry${paid ? ' with the same Request ID' : ''}. Nothing was started.`,
			};
		}
		default:
			if (status >= 500) {
				return paid
					? {
							message: `TrendsFast could not confirm the outcome of ${call.label}${code}`,
							description: `${recovery} ${RECOVER}`,
						}
					: {
							message: `TrendsFast is not available right now (HTTP ${status})${code}`,
							description: 'This read is free; run the step again in a few minutes.',
						};
			}
			return {
				message: `TrendsFast did not accept ${call.label} (HTTP ${status})${code}`,
				description: `${recovery} See https://trendsfast.com/docs#errors.`,
			};
	}
}

/** A TrendsFast answer: its JSON exactly as sent, or a failure that keeps the request ID. */
export function interpretResponse(
	call: PlannedCall,
	requestId: string | undefined,
	response: FullResponse,
	itemIndex: number,
): Outcome {
	const status = typeof response?.statusCode === 'number' ? response.statusCode : 0;
	if (status >= 200 && status < 300) {
		if (isPlainObject(response.body)) return { ok: true, json: response.body };
		return failure(
			`TrendsFast answered ${call.label} without a JSON result`,
			call.charge ? RECOVER : 'This read is free; run the step again.',
			requestId,
			itemIndex,
			status,
		);
	}
	const { message, description } = explainStatus(call, status, response?.body, response?.headers);
	return failure(message, description, requestId, itemIndex, status, response?.body);
}

/**
 * No HTTP answer arrived: a timeout, a dropped connection or a refused credential. For a paid
 * call the request may still have run, so the request ID is the only safe way forward. The
 * low-level detail stays out of the message: n8n replaces a message that names a socket code.
 */
export function transportFailure(
	call: PlannedCall,
	requestId: string | undefined,
	error: unknown,
	itemIndex: number,
): Failure {
	const text =
		error instanceof Error ? error.message.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
	const detail = text ? ` Detail: ${text}` : '';
	return call.charge
		? failure(
				'No answer arrived from TrendsFast, so the outcome is unknown',
				`The request may have reached TrendsFast and run. ${RECOVER}${detail}`,
				requestId,
				itemIndex,
			)
		: failure(
				`No answer arrived from TrendsFast for ${call.label}`,
				`This read is free; run the step again.${detail}`,
				requestId,
				itemIndex,
			);
}

/** A parameter rejected before anything was sent. */
export function inputFailure(error: TrendsFastInputError, itemIndex: number): Failure {
	const message = `${error.message}${itemTag(itemIndex)}`;
	return {
		ok: false,
		kind: 'input',
		message,
		description: `${error.description ?? ''} Nothing was sent to TrendsFast.`.trim(),
		details: {},
		errorJson: { error: message },
	};
}
