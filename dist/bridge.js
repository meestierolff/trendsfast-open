import { Server } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport, } from "@modelcontextprotocol/server/stdio";
import { PACKAGE_NAME, PACKAGE_VERSION, REMOTE_MCP_TOOL_NAMES, } from "./constants.js";
import { configuredEndpoint } from "./endpoint.js";
import { safeErrorMessage, TrendsFastError } from "./errors.js";
import { RemoteMcpClient } from "./remote.js";
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function descriptorFor(tools, name) {
    const descriptor = tools.find((tool) => tool.name === name);
    if (descriptor === undefined) {
        throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "The requested Remote MCP descriptor is missing.");
    }
    return descriptor;
}
export async function createBridgeBackend(options) {
    const clientOptions = {
        endpoint: configuredEndpoint(options.endpoint).href,
        apiKey: options.apiKey,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.timeoutMs === undefined
            ? {}
            : { timeoutMs: options.timeoutMs }),
        ...(options.maxResponseBytes === undefined
            ? {}
            : { maxResponseBytes: options.maxResponseBytes }),
        ...(options.expectedDescriptorSha256 === undefined
            ? {}
            : { expectedDescriptorSha256: options.expectedDescriptorSha256 }),
    };
    const remote = new RemoteMcpClient(clientOptions);
    const { tools } = await remote.verifyContract();
    return {
        tools: [...tools],
        callTool: (name, args = {}) => remote.callTool(name, args),
    };
}
export async function createBridgeServer(options) {
    const backend = await createBridgeBackend(options);
    const tools = backend.tools;
    const server = new Server({ name: PACKAGE_NAME, version: PACKAGE_VERSION }, {
        capabilities: { tools: {} },
        instructions: "TrendsFast project-scoped Remote MCP bridge. Read the latest result before asking the founder to authorize one billable create. Never approve, deliver, publish, or schedule.",
    });
    server.setRequestHandler("tools/list", () => ({ tools }));
    server.setRequestHandler("tools/call", async (request) => {
        const name = request.params.name;
        if (!REMOTE_MCP_TOOL_NAMES.includes(name)) {
            throw new TrendsFastError("UNKNOWN_TOOL", "The local bridge exposes only the exact Remote MCP V1 inventory.");
        }
        const args = request.params.arguments;
        if (args !== undefined && !isObject(args)) {
            throw new TrendsFastError("INVALID_TOOL_INPUT", "Tool arguments must be a JSON object.");
        }
        const result = await backend.callTool(name, args ?? {});
        return server.projectCallToolResult(result, descriptorFor(tools, name).outputSchema);
    });
    return server;
}
export function serveBridge(options) {
    return serveStdio(() => createBridgeServer(options), {
        legacy: "serve",
        transport: new StdioServerTransport(undefined, undefined, {
            maxBufferSize: 1_048_576,
        }),
        onerror(error) {
            options.onError?.(safeErrorMessage(error));
            process.exitCode = 1;
        },
    });
}
export async function runBridge(options) {
    const handle = serveBridge(options);
    let closing = false;
    const close = async () => {
        if (closing)
            return;
        closing = true;
        await handle.close();
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
}
