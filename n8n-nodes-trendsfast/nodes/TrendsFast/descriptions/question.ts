import type { INodeProperties } from 'n8n-workflow';
import { ASK_CREDITS } from '../catalog';
import { maxCreditsField, requestIdField } from './shared';

const showAsk = { resource: ['question'], operation: ['ask'] };

export const questionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['question'] } },
		options: [
			{
				name: 'Ask',
				value: 'ask',
				action: 'Ask question',
				description: `Ask about trends in plain words and get findings with their sources, from saved data. ${ASK_CREDITS} credits; an empty result costs 0.`,
			},
		],
		default: 'ask',
	},
];

export const questionFields: INodeProperties[] = [
	{
		displayName: 'Question',
		name: 'question',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 2 },
		placeholder: 'e.g. What are freelance designers asking about invoicing this week?',
		displayOptions: { show: showAsk },
		description: 'What you want to know, in 3 to 1,000 characters',
	},
	{
		displayName: 'Context ID',
		name: 'contextId',
		type: 'string',
		default: '',
		placeholder: 'e.g. 3f0c2a51-8d4b-4c1e-9f7a-6b2d5e8c1a90',
		displayOptions: { show: showAsk },
		description:
			"Answer for your saved brand context. Leave it empty for a general answer. Get it for free with Account > Get Context; it is 'context.context_id' in that output.",
	},
	maxCreditsField(showAsk, 'A question', ASK_CREDITS),
	requestIdField(showAsk),
];
