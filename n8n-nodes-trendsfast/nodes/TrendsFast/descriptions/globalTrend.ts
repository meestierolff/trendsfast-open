import type { INodeProperties } from 'n8n-workflow';
import {
	CATEGORY_CHOICES,
	CONTENT_TYPE_CHOICES,
	GLOBAL_TRENDS_CREDITS,
	PLATFORM_CHOICES,
	SIGNAL_CHOICES,
} from '../catalog';
import { maxCreditsField, requestIdField } from './shared';

const showQuery = { resource: ['globalTrend'], operation: ['query'] };

export const globalTrendOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['globalTrend'] } },
		options: [
			{
				name: 'Query',
				value: 'query',
				action: 'Query global trends',
				description: `Read what is gaining attention across platforms from saved data, with no brand needed. ${GLOBAL_TRENDS_CREDITS} credit; an empty result costs 0.`,
			},
		],
		default: 'query',
	},
];

export const globalTrendFields: INodeProperties[] = [
	maxCreditsField(showQuery, 'A global trends query', GLOBAL_TRENDS_CREDITS),
	requestIdField(showQuery),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: showQuery },
		options: [
			{
				displayName: 'Categories',
				name: 'categories',
				type: 'multiOptions',
				options: CATEGORY_CHOICES,
				default: [],
				description: 'Only these categories, at most 10',
			},
			{
				displayName: 'Content Types',
				name: 'contentTypes',
				type: 'multiOptions',
				options: CONTENT_TYPE_CHOICES,
				default: [],
				description: 'Only these kinds of content',
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				placeholder: 'e.g. US',
				description:
					'Only observations whose source states this country, as a two-letter code. Many sources state none, so this can narrow a read a lot.',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'e.g. en',
				description: 'Only observations in this language, such as en or en-US',
			},
			{
				displayName: 'Lookback Hours',
				name: 'lookbackHours',
				type: 'number',
				default: 72,
				typeOptions: { minValue: 1, maxValue: 720, numberPrecision: 0 },
				description: 'How far back to read, in hours, from 1 to 720',
			},
			{
				displayName: 'Max Items',
				name: 'maxItems',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
				description: 'The most items to return, from 1 to 100',
			},
			{
				displayName: 'Platforms',
				name: 'platforms',
				type: 'multiOptions',
				options: PLATFORM_CHOICES,
				default: [],
				description: 'Only these platforms',
			},
			{
				displayName: 'Signals',
				name: 'signals',
				type: 'multiOptions',
				options: SIGNAL_CHOICES,
				default: [],
				description: 'Only items with these signals, such as Rising or Emerging',
			},
		],
	},
];
