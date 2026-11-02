import type { INodeProperties } from 'n8n-workflow';
import { OUTLIER_CREDITS } from '../catalog';
import { maxCreditsField, requestIdField } from './shared';

const showCheck = { resource: ['video'], operation: ['checkOutlier'] };

export const videoOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['video'] } },
		options: [
			{
				name: 'Check Outlier',
				value: 'checkOutlier',
				action: 'Check a video against its creator',
				description: `Compare one TikTok, Instagram or YouTube video with its creator’s recent posts: its views against their median. ${OUTLIER_CREDITS} credits, charged only when the video is found; an empty result costs 0.`,
			},
		],
		default: 'checkOutlier',
	},
];

export const videoFields: INodeProperties[] = [
	{
		displayName: 'Video URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://www.tiktok.com/@creator/video/7300000000000000000',
		displayOptions: { show: showCheck },
		description:
			'The video to check: a TikTok video, an Instagram Reel or post, or a YouTube Short or video',
	},
	{
		displayName: 'Handle',
		name: 'handle',
		type: 'string',
		default: '',
		placeholder: 'e.g. @creator',
		displayOptions: { show: showCheck },
		description:
			'The creator’s handle. An Instagram or YouTube link needs it. A TikTok link names its creator, so leave it empty there.',
	},
	maxCreditsField(showCheck, 'A video outlier check', OUTLIER_CREDITS),
	requestIdField(showCheck),
];
