import { Server, type Tool } from "@modelcontextprotocol/server";
import {
  serveStdio,
  StdioServerTransport,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  REMOTE_MCP_TOOL_NAMES,
  type RemoteMcpToolName,
} from "./constants.js";
import { configuredEndpoint } from "./endpoint.js";
import { safeErrorMessage, TrendsFastError } from "./errors.js";
import { RemoteMcpClient, type RemoteMcpClientOptions } from "./remote.js";

type JsonObject = Record<string, unknown>;

export interface BridgeOptions {
  endpoint?: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  onError?: (message: string) => void;
  expectedDescriptorSha256?: Readonly<Record<RemoteMcpToolName, string>>;
}

export interface BridgeBackend {
  readonly tools: Tool[];
  callTool(
    name: RemoteMcpToolName,
    args?: JsonObject,
  ): ReturnType<RemoteMcpClient["callTool"]>;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function descriptorFor(tools: readonly Tool[], name: RemoteMcpToolName): Tool {
  const descriptor = tools.find((tool) => tool.name === name);
  if (descriptor === undefined) {
    throw new TrendsFastError(
      "REMOTE_DESCRIPTOR_DRIFT",
      "The requested Remote MCP descriptor is missing.",
    );
  }
  return descriptor;
}

export async function createBridgeBackend(
  options: BridgeOptions,
): Promise<BridgeBackend> {
  const clientOptions: RemoteMcpClientOptions = {
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

export async function createBridgeServer(
  options: BridgeOptions,
): Promise<Server> {
  const backend = await createBridgeBackend(options);
  const tools = backend.tools;
  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "TrendsFast project-scoped Remote MCP bridge. Read the latest result before asking the founder to authorize one billable create. Never approve, deliver, publish, or schedule.",
    },
  );

  server.setRequestHandler("tools/list", () => ({ tools }));
  server.setRequestHandler("tools/call", async (request) => {
    const name = request.params.name;
    if (!REMOTE_MCP_TOOL_NAMES.includes(name as RemoteMcpToolName)) {
      throw new TrendsFastError(
        "UNKNOWN_TOOL",
        "The local bridge exposes only the exact Remote MCP V1 inventory.",
      );
    }
    const args = request.params.arguments;
    if (args !== undefined && !isObject(args)) {
      throw new TrendsFastError(
        "INVALID_TOOL_INPUT",
        "Tool arguments must be a JSON object.",
      );
    }
    const result = await backend.callTool(
      name as RemoteMcpToolName,
      args ?? {},
    );
    return server.projectCallToolResult(
      result,
      descriptorFor(tools, name as RemoteMcpToolName).outputSchema,
    );
  });
  return server;
}

export function serveBridge(options: BridgeOptions): StdioServerHandle {
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

export async function runBridge(options: BridgeOptions): Promise<void> {
  const handle = serveBridge(options);
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await handle.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}
