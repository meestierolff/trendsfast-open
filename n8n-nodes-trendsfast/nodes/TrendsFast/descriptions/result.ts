import type { INodeProperties } from 'n8n-workflow';
import { cursorOption } from './shared';

const showGet = { resource: ['result'], operation: ['get'] };

export const resultOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['result'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get result',
				description: 'Read a saved result again, one page at a time. Free, for 30 days.',
			},
		],
		default: 'get',
	},
];

export const resultFields: INodeProperties[] = [
	{
		displayName: 'Result ID',
		name: 'resultId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 7c1e9a2b-4d3f-4a8e-b6c5-1f2e3d4c5b6a',
		displayOptions: { show: showGet },
		description: "The 'result_id' of an earlier output, or one from Account > Get History",
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: showGet },
		options: [cursorOption()],
	},
];
