import type { INodeProperties } from 'n8n-workflow';

export const requestOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['request'] } },
		options: [
			{
				name: 'Get by Request ID',
				value: 'get',
				action: 'Get request by ID',
				description:
					'Recover the result or the state of a paid request you sent, by its request ID. Free; use it when a response was lost.',
			},
		],
		default: 'get',
	},
];

export const requestFields: INodeProperties[] = [
	{
		displayName: 'Request ID',
		name: 'requestId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 0d6f3c3e-5b8a-4d6e-9a43-2f1c7b9e8a10',
		displayOptions: { show: { resource: ['request'], operation: ['get'] } },
		description: "The 'request_id' you sent, or the one in a failed item's output",
	},
];
