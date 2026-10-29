/**
 * A parameter this node can check before sending anything. The node turns it into a
 * NodeOperationError for the item, so nothing is sent and nothing is charged.
 */
export class TrendsFastInputError extends Error {
	readonly description: string | undefined;

	constructor(message: string, description?: string) {
		super(message);
		this.name = 'TrendsFastInputError';
		this.description = description;
	}
}
