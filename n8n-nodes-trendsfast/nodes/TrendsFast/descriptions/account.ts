import type { INodeProperties } from 'n8n-workflow';
import { cursorOption } from './shared';

export const accountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get Context',
				value: 'getContext',
				action: 'Get brand context',
				description:
					'Read the brand context TrendsFast holds for this project, including its context ID. Free.',
			},
			{
				name: 'Get History',
				value: 'getHistory',
				action: 'Get result history',
				description:
					'List settled results with their result ID, request ID and credits charged, 50 at a time. Free.',
			},
			{
				name: 'Get Wallet',
				value: 'getWallet',
				action: 'Get credit wallet',
				description: 'Read your credit balance. Free.',
			},
		],
		default: 'getWallet',
	},
];

export const accountFields: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['account'], operation: ['getHistory'] } },
		options: [cursorOption()],
	},
];
