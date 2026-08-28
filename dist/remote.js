import { createHash } from "node:crypto";
import { DEFAULT_REMOTE_TIMEOUT_MS, MAX_REMOTE_REQUEST_BYTES, MAX_REMOTE_RESPONSE_BYTES, REMOTE_MCP_CONTRACT_VERSION, REMOTE_MCP_DESCRIPTOR_SHA256, REMOTE_MCP_PROTOCOL_VERSION, REMOTE_MCP_TOOL_NAMES, } from "./constants.js";
import { TrendsFastError, safeRemoteError } from "./errors.js";
import { configuredEndpoint } from "./endpoint.js";
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasContractMarker(value) {
    if (value === REMOTE_MCP_CONTRACT_VERSION)
        return true;
    if (Array.isArray(value))
        return value.some(hasContractMarker);
    return isObject(value) && Object.values(value).some(hasContractMarker);
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (isObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
function containsForbiddenProjectCapability(value) {
    if (Array.isArray(value))
        return value.some(containsForbiddenProjectCapability);
    if (!isObject(value))
        return false;
    return Object.entries(value).some(([key, nested]) => ["project", "project_id", "projectId"].includes(key) ||
        containsForbiddenProjectCapability(nested));
}
async function readBoundedJson(response, maximumBytes) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximumBytes) {
        throw new TrendsFastError("REMOTE_RESPONSE_TOO_LARGE", "The MCP response exceeded the safe size limit.");
    }
    if (response.body === null) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The MCP response body was empty.");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const next = await reader.read();
        if (next.done)
            break;
        size += next.value.byteLength;
        if (size > maximumBytes) {
            await reader.cancel();
            throw new TrendsFastError("REMOTE_RESPONSE_TOO_LARGE", "The MCP response exceeded the safe size limit.");
        }
        chunks.push(next.value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(joined));
    }
    catch {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The MCP response was not valid JSON.");
    }
}
function validateToolDescriptors(value, expectedDescriptorSha256) {
    if (!Array.isArray(value) || value.length !== REMOTE_MCP_TOOL_NAMES.length) {
        throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "The Remote MCP tool count changed.");
    }
    const tools = [];
    for (const [index, expectedName] of REMOTE_MCP_TOOL_NAMES.entries()) {
        const candidate = value[index];
        if (!isObject(candidate) || candidate.name !== expectedName) {
            throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "The Remote MCP tool order changed.");
        }
        if (!isObject(candidate.inputSchema) || !isObject(candidate.outputSchema)) {
            throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "A Remote MCP tool schema is missing.");
        }
        if (!hasContractMarker(candidate.outputSchema)) {
            throw new TrendsFastError("REMOTE_CONTRACT_DRIFT", "A Remote MCP tool lost its contract marker.");
        }
        const descriptorHash = createHash("sha256")
            .update(canonicalJson(candidate))
            .digest("hex");
        if (descriptorHash !== expectedDescriptorSha256[expectedName]) {
            throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "A Remote MCP tool descriptor changed.");
        }
        tools.push(candidate);
    }
    return tools;
}
function validateApiKey(value) {
    if (value.length < 16 ||
        value.length > 2048 ||
        /[\s\u0000-\u001f\u007f]/u.test(value)) {
        throw new TrendsFastError("INVALID_CREDENTIAL", "The project-scoped API key is malformed.");
    }
    return value;
}
export class RemoteMcpClient {
    endpoint;
    apiKey;
    fetch;
    timeoutMs;
    maxResponseBytes;
    clientName;
    clientVersion;
    expectedDescriptorSha256;
    requestId = 0;
    verifiedTools = null;
    constructor(options) {
        this.endpoint = configuredEndpoint(String(options.endpoint));
        this.apiKey = validateApiKey(options.apiKey);
        this.fetch = options.fetch ?? globalThis.fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
        this.maxResponseBytes =
            options.maxResponseBytes ?? MAX_REMOTE_RESPONSE_BYTES;
        this.clientName = options.clientName ?? "trendsfast-agent";
        this.clientVersion = options.clientVersion ?? "0.1.0-alpha.0";
        this.expectedDescriptorSha256 =
            options.expectedDescriptorSha256 ?? REMOTE_MCP_DESCRIPTOR_SHA256;
    }
    metadata() {
        return {
            "io.modelcontextprotocol/protocolVersion": REMOTE_MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
                name: this.clientName,
                version: this.clientVersion,
            },
        };
    }
    async request(method, params) {
        const id = ++this.requestId;
        const body = {
            jsonrpc: "2.0",
            id,
            method,
            params: { ...params, _meta: this.metadata() },
        };
        const serializedBody = JSON.stringify(body);
        if (Buffer.byteLength(serializedBody) > MAX_REMOTE_REQUEST_BYTES) {
            throw new TrendsFastError("INVALID_TOOL_INPUT", "The MCP request exceeded the safe size limit.");
        }
        const headers = new Headers({
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "MCP-Protocol-Version": REMOTE_MCP_PROTOCOL_VERSION,
            "Mcp-Method": method,
        });
        if (method === "tools/call") {
            const name = params.name;
            if (typeof name !== "string") {
                throw new TrendsFastError("INVALID_TOOL_INPUT", "The tool name is missing.");
            }
            headers.set("Mcp-Name", name);
            if (name === "trendsfast_today_create") {
                const args = params.arguments;
                const idempotencyKey = isObject(args)
                    ? args.idempotency_key
                    : undefined;
                if (typeof idempotencyKey !== "string") {
                    throw new TrendsFastError("INVALID_TOOL_INPUT", "The create idempotency key is missing.");
                }
                headers.set("Mcp-Param-Idempotency-Key", idempotencyKey);
            }
        }
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), this.timeoutMs);
        let response;
        try {
            response = await this.fetch(this.endpoint, {
                method: "POST",
                headers,
                body: serializedBody,
                redirect: "manual",
                signal: abort.signal,
            });
        }
        catch (error) {
            if (abort.signal.aborted) {
                throw new TrendsFastError("REMOTE_TIMEOUT", "The MCP request timed out.");
            }
            throw new TrendsFastError("REMOTE_UNAVAILABLE", "The MCP endpoint could not be reached safely.", {
                cause: error,
            });
        }
        finally {
            clearTimeout(timer);
        }
        if (response.status >= 300 && response.status < 400) {
            throw new TrendsFastError("REMOTE_REDIRECT_REJECTED", "The MCP endpoint attempted a redirect.");
        }
        if (response.headers.has("mcp-session-id")) {
            throw new TrendsFastError("REMOTE_PROTOCOL_DRIFT", "The stateless Remote MCP endpoint created a session.");
        }
        if (response.url !== "") {
            let responseUrl;
            try {
                responseUrl = new URL(response.url);
            }
            catch {
                throw new TrendsFastError("REMOTE_ORIGIN_MISMATCH", "The MCP response origin was invalid.");
            }
            if (responseUrl.origin !== this.endpoint.origin ||
                responseUrl.pathname !== this.endpoint.pathname ||
                responseUrl.search !== "" ||
                responseUrl.hash !== "") {
                throw new TrendsFastError("REMOTE_ORIGIN_MISMATCH", "The MCP response came from another origin.");
            }
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The MCP endpoint returned an unsupported media type.");
        }
        const payload = await readBoundedJson(response, this.maxResponseBytes);
        if (!response.ok) {
            if (isObject(payload)) {
                throw safeRemoteError(payload.code, payload.retryable, payload.retry_after_seconds);
            }
            throw new TrendsFastError("REMOTE_HTTP_FAILURE", "The MCP endpoint rejected the request safely.");
        }
        if (!isObject(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The MCP JSON-RPC response did not match the request.");
        }
        if (isObject(payload.error)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The MCP protocol rejected the request safely.");
        }
        if (!isObject(payload.result)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The MCP result was missing.");
        }
        return payload.result;
    }
    async verifyContract() {
        const discovery = await this.request("server/discover", {});
        if (discovery.resultType !== "complete" ||
            !Array.isArray(discovery.supportedVersions) ||
            discovery.supportedVersions.length !== 1 ||
            discovery.supportedVersions[0] !== REMOTE_MCP_PROTOCOL_VERSION ||
            !isObject(discovery.capabilities) ||
            !isObject(discovery.capabilities.tools)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_DRIFT", "The Remote MCP protocol identity changed.");
        }
        const meta = discovery._meta;
        const serverInfo = isObject(meta)
            ? meta["io.modelcontextprotocol/serverInfo"]
            : undefined;
        if (!isObject(serverInfo) || serverInfo.name !== "trendsfast-remote-mcp") {
            throw new TrendsFastError("REMOTE_CONTRACT_DRIFT", "The Remote MCP server identity changed.");
        }
        const listed = await this.request("tools/list", {});
        if (listed.resultType !== "complete" ||
            "nextCursor" in listed ||
            "cursor" in listed) {
            throw new TrendsFastError("REMOTE_PROTOCOL_DRIFT", "The Remote MCP tool list was incomplete.");
        }
        const tools = validateToolDescriptors(listed.tools, this.expectedDescriptorSha256);
        this.verifiedTools = tools;
        return { discovery, tools };
    }
    async callTool(name, args = {}) {
        if (!REMOTE_MCP_TOOL_NAMES.includes(name)) {
            throw new TrendsFastError("UNKNOWN_TOOL", "The requested tool is outside the exact Remote MCP V1 inventory.");
        }
        if (containsForbiddenProjectCapability(args)) {
            throw new TrendsFastError("INVALID_TOOL_INPUT", "Project identity must come from the API key, not tool arguments.");
        }
        if (this.verifiedTools === null)
            await this.verifyContract();
        const result = await this.request("tools/call", { name, arguments: args });
        if (result.resultType !== "complete" ||
            typeof result.isError !== "boolean" ||
            !isObject(result.structuredContent) ||
            !Array.isArray(result.content)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP tool result was malformed.");
        }
        const text = result.content.find((item) => isObject(item) && item.type === "text" && typeof item.text === "string");
        if (text === undefined ||
            text.text !== JSON.stringify(result.structuredContent)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP structured result lost text parity.");
        }
        return result;
    }
    getVerifiedTools() {
        if (this.verifiedTools === null) {
            throw new TrendsFastError("REMOTE_NOT_VERIFIED", "The Remote MCP contract has not been verified.");
        }
        return this.verifiedTools;
    }
}
