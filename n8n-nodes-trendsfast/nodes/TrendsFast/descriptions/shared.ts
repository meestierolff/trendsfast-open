import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';
import { MAX_CREDITS_CEILING } from '../catalog';

type Show = NonNullable<IDisplayOptions['show']>;

/** The spending cap of a paid call, defaulting to that call's price. */
export function maxCreditsField(show: Show, what: string, credits: number): INodeProperties {
	const unit = credits === 1 ? 'credit' : 'credits';
	return {
		displayName: 'Max Credits',
		name: 'maxCredits',
		type: 'number',
		required: true,
		default: credits,
		typeOptions: { minValue: 0, maxValue: MAX_CREDITS_CEILING, numberPrecision: 0 },
		displayOptions: { show },
		description: `The most credits this call may spend. ${what} costs ${credits} ${unit} and an empty result costs 0. If the price is above this number, TrendsFast does not start the call and charges nothing.`,
	};
}

/** The idempotency key of a paid call. */
export function requestIdField(show: Show): INodeProperties {
	return {
		displayName: 'Request ID',
		name: 'requestId',
		type: 'string',
		default: '',
		placeholder: 'e.g. 0d6f3c3e-5b8a-4d6e-9a43-2f1c7b9e8a10',
		displayOptions: { show },
		description:
			"The UUID that makes this paid call safe to retry. Leave it empty and the node creates one per item from this execution, so a retry in the same execution replays the first result instead of charging again. To retry or recover an item later, use the 'request_id' from its output.",
	};
}

/** A cursor option for reads that return one page at a time. */
export function cursorOption(): INodeProperties {
	return {
		displayName: 'Cursor',
		name: 'cursor',
		type: 'string',
		default: '',
		description: "The 'next_cursor' of the previous page. Leave it empty for the first page.",
	};
}
