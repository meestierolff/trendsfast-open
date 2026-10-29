import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TrendsFastApi implements ICredentialType {
	name = 'trendsFastApi';

	displayName = 'TrendsFast API';

	icon: Icon = { light: 'file:../icons/trendsfast.svg', dark: 'file:../icons/trendsfast.dark.svg' };

	documentationUrl = 'https://trendsfast.com/docs#auth';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. tf_live_...',
			description:
				'A TrendsFast project API key, created under API keys in your TrendsFast dashboard. Give it the trends:query, trends:read and credits:read scopes; the credential test reads your wallet, which needs credits:read.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// GET /v3/trends/wallet is free: it reads the balance and never spends credits.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://trendsfast.com',
			url: '/v3/trends/wallet',
			method: 'GET',
		},
	};
}
