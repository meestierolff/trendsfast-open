import { createHash, randomUUID } from 'crypto';
import { TrendsFastInputError } from './inputError';

/** The UUID shape TrendsFast accepts for request, result and context IDs (versions 1 to 8). */
export const UUID_PATTERN =
	/^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

/** Fixed namespace for request IDs this package derives (RFC 9562 name-based, version 5). */
export const REQUEST_ID_NAMESPACE = 'a13c1078-6896-413d-be9e-6e7585220b75';

/** What identifies one execution of one node on one n8n instance. */
export interface ExecutionIdentity {
	instanceId: string;
	executionId: string;
	nodeId: string;
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index++) {
		bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

/** A version 5 UUID: SHA-1 over the namespace and the name, with the version and variant set. */
export function uuidV5(namespace: string, name: string): string {
	const digest = createHash('sha1')
		.update(hexToBytes(namespace.replace(/-/g, '')))
		.update(name, 'utf8')
		.digest('hex');
	const variant = ((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
	const hex = `${digest.slice(0, 12)}5${digest.slice(13, 16)}${variant}${digest.slice(17, 32)}`;
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The request ID one paid call carries.
 *
 * A supplied ID is used exactly as given, so a retry or a recovery can reuse the ID from an
 * earlier output. Without one, the ID is derived from this n8n instance, execution and node
 * plus the request itself. The same request from the same node in the same execution therefore
 * always carries the same ID: n8n's Retry On Fail, a queue-mode restart or a repeated AI tool
 * call replays the first outcome instead of being charged again, while a new execution, or a
 * different request, gets a new ID. Without an execution ID a random one is used.
 */
export function resolveRequestId(
	supplied: unknown,
	identity: ExecutionIdentity | undefined,
	fingerprint: string,
	random: () => string = randomUUID,
): string {
	const given = typeof supplied === 'string' ? supplied.trim() : '';
	if (given) {
		if (!UUID_PATTERN.test(given)) {
			throw new TrendsFastInputError(
				`'Request ID' must be a UUID, such as the 'request_id' of an earlier output`,
				'Leave it empty to let the node create one for each item.',
			);
		}
		return given;
	}
	if (!identity?.executionId) return random();
	return uuidV5(
		REQUEST_ID_NAMESPACE,
		JSON.stringify([identity.instanceId, identity.executionId, identity.nodeId, fingerprint]),
	);
}
