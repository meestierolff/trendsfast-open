import type { INodeProperties } from 'n8n-workflow';
import { accountFields, accountOperations } from './account';
import { globalTrendFields, globalTrendOperations } from './globalTrend';
import { productFields, productOperations } from './product';
import { questionFields, questionOperations } from './question';
import { requestFields, requestOperations } from './request';
import { resultFields, resultOperations } from './result';

export const trendsFastProperties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Account',
				value: 'account',
				description: 'Your credit balance, brand context and result history. Free.',
			},
			{
				name: 'Global Trend',
				value: 'globalTrend',
				description: 'What is gaining attention across platforms, with no brand needed',
			},
			{
				name: 'Product',
				value: 'product',
				description: 'The five products: Customers, Trending, Competitors, Formats and Search',
			},
			{
				name: 'Question',
				value: 'question',
				description: 'A question about trends, asked in plain words',
			},
			{
				name: 'Request',
				value: 'request',
				description: 'A paid request you sent, looked up by its request ID',
			},
			{
				name: 'Result',
				value: 'result',
				description: 'A saved result, read again for free',
			},
		],
		default: 'product',
	},
	...productOperations,
	...productFields,
	...globalTrendOperations,
	...globalTrendFields,
	...questionOperations,
	...questionFields,
	...resultOperations,
	...resultFields,
	...requestOperations,
	...requestFields,
	...accountOperations,
	...accountFields,
];
