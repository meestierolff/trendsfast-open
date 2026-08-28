import { createHash } from "node:crypto";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";
import { DEFAULT_REMOTE_TIMEOUT_MS, MAX_REMOTE_REQUEST_BYTES, MAX_REMOTE_RESPONSE_BYTES, REMOTE_MCP_CONTRACT_VERSION, REMOTE_MCP_DESCRIPTOR_SHA256, REMOTE_MCP_DOCUMENTATION_URL, REMOTE_MCP_ENDPOINT, REMOTE_MCP_PROTOCOL_VERSION, REMOTE_MCP_TOOL_NAMES, } from "./constants.js";
import { TrendsFastError, safeRemoteError } from "./errors.js";
import { configuredEndpoint } from "./endpoint.js";
const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";
const REMOTE_MCP_SERVER_INFO = Object.freeze({
    name: "trendsfast-remote-mcp",
    title: "TrendsFast",
    version: "1.0.0",
    description: "Project-scoped access to Today’s Trend Briefs, confirmed context, immutable creative handoffs, and public source status. No publishing or scheduling.",
    websiteUrl: REMOTE_MCP_DOCUMENTATION_URL,
    icons: [
        {
            src: new URL("/icons/signal-sprite-512.png", REMOTE_MCP_ENDPOINT).href,
            mimeType: "image/png",
            sizes: ["512x512"],
        },
    ],
});
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
    const actual = Object.keys(value);
    return (actual.length === expected.length &&
        expected.every((key) => Object.hasOwn(value, key)));
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
function remoteTimeout() {
    return new TrendsFastError("REMOTE_TIMEOUT", "The MCP request timed out.");
}
function serverIdentityFromResult(result, expectedServerIdentity) {
    const meta = result._meta;
    if (!isObject(meta) || !hasExactKeys(meta, [SERVER_INFO_META_KEY])) {
        throw new TrendsFastError("REMOTE_CONTRACT_DRIFT", "The Remote MCP response metadata shape changed.");
    }
    const serverInfo = meta[SERVER_INFO_META_KEY];
    if (!isObject(serverInfo)) {
        throw new TrendsFastError("REMOTE_CONTRACT_DRIFT", "The Remote MCP server identity changed.");
    }
    const serverIdentity = canonicalJson(serverInfo);
    if (serverIdentity !== canonicalJson(REMOTE_MCP_SERVER_INFO)) {
        throw new TrendsFastError("REMOTE_CONTRACT_DRIFT", "The Remote MCP authoritative server metadata changed.");
    }
    if (expectedServerIdentity !== undefined &&
        serverIdentity !== expectedServerIdentity) {
        throw new TrendsFastError("REMOTE_CONTRACT_DRIFT", "The Remote MCP response identity changed within the verified session.");
    }
    return serverIdentity;
}
function containsForbiddenProjectCapability(value) {
    if (Array.isArray(value))
        return value.some(containsForbiddenProjectCapability);
    if (!isObject(value))
        return false;
    return Object.entries(value).some(([key, nested]) => ["project", "project_id", "projectId"].includes(key) ||
        containsForbiddenProjectCapability(nested));
}
async function readBoundedJson(response, maximumBytes, signal) {
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
        if (signal.aborted)
            throw remoteTimeout();
        const next = await new Promise((resolve, reject) => {
            const aborted = () => {
                signal.removeEventListener("abort", aborted);
                void reader.cancel().catch(() => undefined);
                reject(remoteTimeout());
            };
            signal.addEventListener("abort", aborted, { once: true });
            if (signal.aborted) {
                aborted();
                return;
            }
            void reader
                .read()
                .then(resolve, reject)
                .finally(() => {
                signal.removeEventListener("abort", aborted);
            });
        });
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
function compileOutputValidators(tools) {
    const validators = new Map();
    try {
        for (const tool of tools) {
            const name = tool.name;
            if (tool.outputSchema === undefined) {
                throw new Error("missing output schema");
            }
            // A fresh provider per descriptor prevents a remote `$id` from making
            // one tool accidentally reuse another tool's compiled schema.
            validators.set(name, new AjvJsonSchemaValidator().getValidator(tool.outputSchema));
        }
    }
    catch {
        throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "A Remote MCP output schema could not be compiled safely.");
    }
    return validators;
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
    verifiedServerIdentity = null;
    verifiedOutputValidators = null;
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
        try {
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
                if (abort.signal.aborted)
                    throw remoteTimeout();
                throw new TrendsFastError("REMOTE_UNAVAILABLE", "The MCP endpoint could not be reached safely.", { cause: error });
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
            let payload;
            try {
                payload = await readBoundedJson(response, this.maxResponseBytes, abort.signal);
            }
            catch (error) {
                if (error instanceof TrendsFastError)
                    throw error;
                if (abort.signal.aborted)
                    throw remoteTimeout();
                throw new TrendsFastError("REMOTE_UNAVAILABLE", "The MCP response body could not be read safely.", { cause: error });
            }
            if (!response.ok) {
                if (isObject(payload)) {
                    throw safeRemoteError(payload.version, payload.code, payload.retryable, payload.retry_after_seconds);
                }
                throw new TrendsFastError("REMOTE_HTTP_FAILURE", "The MCP endpoint rejected the request safely.");
            }
            if (!isObject(payload) ||
                payload.jsonrpc !== "2.0" ||
                payload.id !== id) {
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
        finally {
            clearTimeout(timer);
        }
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
        const serverIdentity = serverIdentityFromResult(discovery);
        const listed = await this.request("tools/list", {});
        if (listed.resultType !== "complete" ||
            "nextCursor" in listed ||
            "cursor" in listed) {
            throw new TrendsFastError("REMOTE_PROTOCOL_DRIFT", "The Remote MCP tool list was incomplete.");
        }
        serverIdentityFromResult(listed, serverIdentity);
        const tools = validateToolDescriptors(listed.tools, this.expectedDescriptorSha256);
        const outputValidators = compileOutputValidators(tools);
        this.verifiedTools = tools;
        this.verifiedServerIdentity = serverIdentity;
        this.verifiedOutputValidators = outputValidators;
        return { discovery, tools };
    }
    async callTool(name, args = {}) {
        if (!REMOTE_MCP_TOOL_NAMES.includes(name)) {
            throw new TrendsFastError("UNKNOWN_TOOL", "The requested tool is outside the exact Remote MCP V1 inventory.");
        }
        if (containsForbiddenProjectCapability(args)) {
            throw new TrendsFastError("INVALID_TOOL_INPUT", "Project identity must come from the API key, not tool arguments.");
        }
        if (this.verifiedTools === null ||
            this.verifiedServerIdentity === null ||
            this.verifiedOutputValidators === null) {
            await this.verifyContract();
        }
        const result = await this.request("tools/call", { name, arguments: args });
        if (result.resultType !== "complete" ||
            typeof result.isError !== "boolean" ||
            !isObject(result.structuredContent) ||
            !Array.isArray(result.content)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP tool result was malformed.");
        }
        if (this.verifiedServerIdentity === null ||
            this.verifiedOutputValidators === null) {
            throw new TrendsFastError("REMOTE_NOT_VERIFIED", "The Remote MCP contract verification was incomplete.");
        }
        serverIdentityFromResult(result, this.verifiedServerIdentity);
        if (!hasExactKeys(result, [
            "resultType",
            "content",
            "structuredContent",
            "isError",
            "_meta",
        ])) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP tool result exposed unregistered top-level fields.");
        }
        const outputValidator = this.verifiedOutputValidators.get(name);
        if (outputValidator === undefined) {
            throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "The verified Remote MCP output schema is missing.");
        }
        let outputValid = false;
        try {
            outputValid = outputValidator(result.structuredContent).valid;
        }
        catch {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP structured result could not be validated safely.");
        }
        if (!outputValid) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP structured result did not match its verified output schema.");
        }
        const envelope = result.structuredContent;
        if ((envelope.ok === true &&
            (result.isError || !("data" in envelope) || "error" in envelope)) ||
            (envelope.ok === false &&
                (!result.isError || !("error" in envelope) || "data" in envelope)) ||
            (envelope.ok !== true && envelope.ok !== false)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP error flag did not match its structured envelope.");
        }
        const text = result.content[0];
        if (result.content.length !== 1 ||
            !isObject(text) ||
            Object.keys(text).length !== 2 ||
            !Object.hasOwn(text, "type") ||
            !Object.hasOwn(text, "text") ||
            text.type !== "text" ||
            typeof text.text !== "string" ||
            text.text !== JSON.stringify(result.structuredContent)) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The Remote MCP structured result lost its exact text-only parity.");
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
