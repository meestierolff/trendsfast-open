import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import { CREDENTIAL_TYPE } from './catalog';
import { trendsFastProperties } from './descriptions';
import { TrendsFastInputError } from './transport/inputError';
import {
	type FullResponse,
	type Outcome,
	inputFailure,
	interpretResponse,
	transportFailure,
} from './transport/outcome';
import { fingerprint, httpRequestOptions, planCall, type PlannedCall } from './transport/planCall';
import { type ExecutionIdentity, resolveRequestId } from './transport/requestId';

/**
 * This node is programmatic rather than declarative on purpose. A paid call needs a request ID
 * the workflow can see even when no answer arrives (a timeout or a dropped connection), so the
 * request can be recovered for free or retried without paying twice. Declarative routing hands
 * transport failures straight to n8n with no hook to attach that ID, so each call here is one
 * plain authenticated request built by `planCall`, with redirects off and no automatic resend.
 */
export class TrendsFast implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TrendsFast',
		name: 'trendsFast',
		icon: {
			light: 'file:../../icons/trendsfast.svg',
			dark: 'file:../../icons/trendsfast.dark.svg',
		},
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Find where your customers talk, what is trending in your niche and what competitors post, with sources',
		defaults: {
			name: 'TrendsFast',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL_TYPE,
				required: true,
			},
		],
		properties: trendsFastProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const identity = executionIdentity(this);

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const outcome = await runItem(this, itemIndex, identity);
			if (outcome.ok) {
				returnData.push({ json: outcome.json, pairedItem: { item: itemIndex } });
				continue;
			}
			const error =
				outcome.kind === 'input'
					? new NodeOperationError(this.getNode(), outcome.message, {
							itemIndex,
							description: outcome.description,
						})
					: new NodeApiError(this.getNode(), outcome.details as JsonObject, {
							itemIndex,
							message: outcome.message,
							description: outcome.description,
							httpCode: outcome.httpCode,
						});
			if (this.continueOnFail()) {
				returnData.push({ json: outcome.errorJson, error, pairedItem: { item: itemIndex } });
				continue;
			}
			throw error;
		}

		return [returnData];
	}
}

/** Who is asking, for request IDs that stay stable across retries in one execution. */
function executionIdentity(context: IExecuteFunctions): ExecutionIdentity | undefined {
	const executionId = context.getExecutionId();
	if (!executionId) return undefined;
	return {
		instanceId: context.getInstanceId() ?? '',
		executionId,
		nodeId: context.getNode().id ?? context.getNode().name,
	};
}

async function runItem(
	context: IExecuteFunctions,
	itemIndex: number,
	identity: ExecutionIdentity | undefined,
): Promise<Outcome> {
	let call: PlannedCall;
	let requestId: string | undefined;
	try {
		const resource = context.getNodeParameter('resource', itemIndex) as string;
		const operation = context.getNodeParameter('operation', itemIndex) as string;
		call = planCall(resource, operation, (name, fallback) =>
			context.getNodeParameter(name, itemIndex, fallback),
		);
		if (call.charge) {
			requestId = resolveRequestId(call.charge.suppliedRequestId, identity, fingerprint(call));
		}
	} catch (error) {
		if (error instanceof TrendsFastInputError) return inputFailure(error, itemIndex);
		throw new NodeOperationError(context.getNode(), error as Error, { itemIndex });
	}

	let response: FullResponse;
	try {
		response = (await context.helpers.httpRequestWithAuthentication.call(
			context,
			CREDENTIAL_TYPE,
			httpRequestOptions(call, requestId),
		)) as FullResponse;
	} catch (error) {
		return transportFailure(call, requestId, error, itemIndex);
	}
	return interpretResponse(call, requestId, response, itemIndex);
}
