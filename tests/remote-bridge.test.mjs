import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  MAX_REMOTE_REQUEST_BYTES,
  REMOTE_MCP_CONTRACT_VERSION,
  REMOTE_MCP_DESCRIPTOR_SHA256,
  REMOTE_MCP_PROTOCOL_VERSION,
  REMOTE_MCP_TOOL_NAMES,
} from "../dist/constants.js";
import { validateEndpoint } from "../dist/endpoint.js";
import { RemoteMcpClient } from "../dist/remote.js";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SYNTHETIC_BEARER = "synthetic-test-key";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function descriptorInput(name) {
  if (name === "trendsfast_today_create") {
    return {
      type: "object",
      properties: {
        idempotency_key: { type: "string", format: "uuid" },
        objective: { type: "string" },
        confirmed_capabilities: { type: "array", items: { type: "string" } },
      },
      required: ["idempotency_key", "objective", "confirmed_capabilities"],
      additionalProperties: false,
    };
  }
  if (name === "trendsfast_today_status_get") {
    return {
      type: "object",
      properties: { scan_id: { type: "string" } },
      required: ["scan_id"],
      additionalProperties: false,
    };
  }
  if (
    name === "trendsfast_brief_get" ||
    name === "trendsfast_creative_handoff_get"
  ) {
    return {
      type: "object",
      properties: { brief_id: { type: "string" } },
      required: ["brief_id"],
      additionalProperties: false,
    };
  }
  return { type: "object", properties: {}, additionalProperties: false };
}

/**
 * Compact, public-safe wire descriptors used only by the local fixture. The
 * production client still defaults to REMOTE_MCP_DESCRIPTOR_SHA256; tests pass
 * this separately hashed set only through the non-CLI test seam.
 */
const SYNTHETIC_DESCRIPTORS = Object.freeze(
  REMOTE_MCP_TOOL_NAMES.map((name) => {
    const create = name === "trendsfast_today_create";
    return Object.freeze({
      name,
      title: `Synthetic ${name}`,
      description: `Synthetic Remote MCP V1 descriptor for ${name}.`,
      inputSchema: descriptorInput(name),
      outputSchema: {
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: {
              ok: { const: true },
              data: { type: "object", additionalProperties: true },
            },
            required: ["ok", "data"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              ok: { const: false },
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
                required: ["code", "message"],
                additionalProperties: false,
              },
            },
            required: ["ok", "error"],
            additionalProperties: false,
          },
        ],
        $comment: REMOTE_MCP_CONTRACT_VERSION,
      },
      annotations: {
        readOnlyHint: !create,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: create,
      },
      _meta: {
        "com.trendsfast/requiredScopes": [
          create ? "next_move:write" : "next_move:read",
        ],
        "com.trendsfast/effectBoundary": create
          ? "BOUNDED_TODAY_ADMISSION"
          : "READ_ONLY_ZERO_EFFECT",
      },
    });
  }),
);

function descriptorHashes(descriptors) {
  return Object.fromEntries(
    descriptors.map((descriptor) => [
      descriptor.name,
      createHash("sha256").update(canonicalJson(descriptor)).digest("hex"),
    ]),
  );
}

const SYNTHETIC_DESCRIPTOR_SHA256 = Object.freeze(
  descriptorHashes(SYNTHETIC_DESCRIPTORS),
);

function fixtureServerInfo() {
  return {
    name: "trendsfast-remote-mcp",
    title: "TrendsFast",
    version: "1.0.0",
    description:
      "Project-scoped access to Today’s Trend Briefs, confirmed context, immutable creative handoffs, and public source status. No publishing or scheduling.",
    websiteUrl: "https://trendsfast.com/mcp",
    icons: [
      {
        src: "https://trendsfast.com/icons/signal-sprite-512.png",
        mimeType: "image/png",
        sizes: ["512x512"],
      },
    ],
  };
}

function fixtureResponseMeta() {
  return {
    "io.modelcontextprotocol/serverInfo": fixtureServerInfo(),
  };
}

function discovery() {
  return {
    resultType: "complete",
    supportedVersions: [REMOTE_MCP_PROTOCOL_VERSION],
    capabilities: { tools: {} },
    _meta: fixtureResponseMeta(),
  };
}

function completeToolResult(name) {
  const structuredContent = {
    ok: true,
    data: { source: "synthetic-local-fixture", tool: name },
  };
  return {
    resultType: "complete",
    isError: false,
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    _meta: fixtureResponseMeta(),
  };
}

function completeToolError(isError = true) {
  const structuredContent = {
    ok: false,
    error: {
      code: "INVALID_TOOL_INPUT",
      message: "The registered tool input is invalid.",
    },
  };
  return {
    resultType: "complete",
    isError,
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    _meta: fixtureResponseMeta(),
  };
}

function toolResultForMode(name, mode) {
  if (mode === "tool-error") return completeToolError(true);
  if (mode === "inconsistent-error-flag") return completeToolError(false);
  const result = completeToolResult(name);
  if (mode === "inconsistent-success-flag") result.isError = true;
  if (mode === "invalid-structured-content") {
    result.structuredContent = { ok: true, data: "not-an-object" };
    result.content = [
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ];
  }
  if (mode === "malicious-structured-content") {
    result.structuredContent = {
      ok: true,
      data: { source: "synthetic-local-fixture", tool: name },
      private_provider_payload: "must-not-escape",
    };
    result.content = [
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ];
  }
  if (mode === "extra-content-block") {
    result.content.push({ type: "text", text: "untrusted extra block" });
  }
  if (mode === "extra-content-field") {
    result.content[0] = {
      ...result.content[0],
      annotations: { audience: ["assistant"] },
    };
  }
  if (mode === "extra-result-field") {
    result.private_provider_payload = "must-not-escape";
  }
  if (mode === "extra-meta-field") {
    result._meta.private_provider_payload = "must-not-escape";
  }
  return result;
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startRemoteFixture(t) {
  const state = {
    mode: "normal",
    requests: [],
    descriptors: SYNTHETIC_DESCRIPTORS,
    handlerErrors: [],
    omitMetadataFor: null,
    driftMetadataFor: null,
    driftMetadataField: "description",
  };
  const server = createServer((request, response) => {
    void (async () => {
      const body = await readRequest(request);
      state.requests.push({
        body,
        headers: request.headers,
        method: request.method,
      });
      const mode = state.mode;
      state.mode = "normal";

      if (mode === "redirect") {
        response.writeHead(307, {
          Location: "https://redirect.invalid/api/mcp",
        });
        response.end();
        return;
      }
      if (mode === "timeout") {
        setTimeout(() => {
          if (!response.destroyed) {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: discovery(),
              }),
            );
          }
        }, 250).unref();
        return;
      }
      if (mode === "body-stall") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.flushHeaders();
        return;
      }
      if (mode === "safe-error") {
        response.writeHead(429, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            version: REMOTE_MCP_CONTRACT_VERSION,
            code: "RATE_LIMITED",
            retryable: true,
            retry_after_seconds: 7,
            private_provider_detail: "must-not-escape",
          }),
        );
        return;
      }

      let result;
      if (body.method === "server/discover") {
        result = discovery();
      } else if (body.method === "tools/list") {
        result = {
          resultType: "complete",
          tools: state.descriptors,
          _meta: fixtureResponseMeta(),
        };
      } else if (body.method === "tools/call") {
        result = toolResultForMode(body.params?.name, mode);
      } else {
        throw new Error(`Unexpected synthetic method: ${String(body.method)}`);
      }

      if (state.omitMetadataFor === body.method) delete result._meta;
      if (state.driftMetadataFor === body.method) {
        result._meta = fixtureResponseMeta();
        const info = result._meta["io.modelcontextprotocol/serverInfo"];
        if (state.driftMetadataField === "websiteUrl") {
          info.websiteUrl = "https://attacker.invalid/mcp";
        } else if (state.driftMetadataField === "icon") {
          info.icons[0].sizes = ["256x256"];
        } else {
          info.description = "drifted response identity";
        }
      }

      const headers = { "Content-Type": "application/json" };
      if (mode === "session") headers["Mcp-Session-Id"] = "forbidden-session";
      const payload =
        mode === "oversized"
          ? { jsonrpc: "2.0", id: body.id, result, padding: "x".repeat(8_192) }
          : { jsonrpc: "2.0", id: body.id, result };
      response.writeHead(200, headers);
      response.end(JSON.stringify(payload));
    })().catch((error) => {
      state.handlerErrors.push(error);
      if (!response.headersSent)
        response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: "INTERNAL_FAILURE" }));
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "localhost", resolveListen);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");

  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  });
  return {
    endpoint: `http://localhost:${address.port}/api/mcp`,
    server,
    state,
  };
}

function remoteClient(fixture, overrides = {}) {
  process.env.TRENDSFAST_TEST_MODE = "1";
  return new RemoteMcpClient({
    endpoint: fixture.endpoint,
    apiKey: SYNTHETIC_BEARER,
    expectedDescriptorSha256: SYNTHETIC_DESCRIPTOR_SHA256,
    ...overrides,
  });
}

function assertTrendsFastCode(expectedCode) {
  return (error) => {
    assert.equal(error?.name, "TrendsFastError");
    assert.equal(error?.code, expectedCode);
    return true;
  };
}

test("endpoint validation rejects alternate authority and path forms", () => {
  assert.equal(
    validateEndpoint("https://trendsfast.com/api/mcp").href,
    "https://trendsfast.com/api/mcp",
  );
  assert.equal(
    validateEndpoint("http://localhost:43123/api/mcp", { allowLocalhost: true })
      .href,
    "http://localhost:43123/api/mcp",
  );

  const invalid = [
    "http://trendsfast.com/api/mcp",
    "https://user@trendsfast.com/api/mcp",
    "https://user:password@trendsfast.com/api/mcp",
    "https://trendsfast.com/api/mcp?key=value",
    "https://trendsfast.com/api/mcp#fragment",
    "https://trendsfast.com/other",
    "https://127.0.0.1/api/mcp",
    "https://[::1]/api/mcp",
    "http://localhost:43123/api/mcp",
  ];
  for (const endpoint of invalid) {
    assert.throws(
      () => validateEndpoint(endpoint),
      assertTrendsFastCode("INVALID_ENDPOINT"),
    );
  }
});

test("production descriptor pins remain exact and cannot accept synthetic fixtures by default", async (t) => {
  const fixture = await startRemoteFixture(t);
  assert.deepEqual(Object.keys(REMOTE_MCP_DESCRIPTOR_SHA256), [
    ...REMOTE_MCP_TOOL_NAMES,
  ]);
  for (const hash of Object.values(REMOTE_MCP_DESCRIPTOR_SHA256)) {
    assert.match(hash, /^[a-f0-9]{64}$/u);
  }
  assert.notDeepEqual(
    REMOTE_MCP_DESCRIPTOR_SHA256,
    SYNTHETIC_DESCRIPTOR_SHA256,
  );

  process.env.TRENDSFAST_TEST_MODE = "1";
  const productionDefaults = new RemoteMcpClient({
    endpoint: fixture.endpoint,
    apiKey: SYNTHETIC_BEARER,
  });
  await assert.rejects(
    productionDefaults.verifyContract(),
    assertTrendsFastCode("REMOTE_DESCRIPTOR_DRIFT"),
  );
});

test("verifies exact seven ordered descriptors and rejects order, count, and hash drift", async (t) => {
  const fixture = await startRemoteFixture(t);
  const verified = await remoteClient(fixture).verifyContract();
  assert.deepEqual(
    verified.tools.map(({ name }) => name),
    [...REMOTE_MCP_TOOL_NAMES],
  );
  assert.equal(verified.tools.length, 7);

  fixture.state.descriptors = [
    SYNTHETIC_DESCRIPTORS[1],
    SYNTHETIC_DESCRIPTORS[0],
    ...SYNTHETIC_DESCRIPTORS.slice(2),
  ];
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_DESCRIPTOR_DRIFT"),
  );

  fixture.state.descriptors = SYNTHETIC_DESCRIPTORS.slice(0, -1);
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_DESCRIPTOR_DRIFT"),
  );

  fixture.state.descriptors = SYNTHETIC_DESCRIPTORS.map((descriptor, index) =>
    index === 0
      ? { ...descriptor, description: `${descriptor.description} drift` }
      : descriptor,
  );
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_DESCRIPTOR_DRIFT"),
  );
  assert.deepEqual(fixture.state.handlerErrors, []);
});

test("rejects output schemas that declare untrusted dialects or remote references", async (t) => {
  const fixture = await startRemoteFixture(t);
  const maliciousSchemas = [
    {
      ...SYNTHETIC_DESCRIPTORS[0].outputSchema,
      $schema: "https://attacker.invalid/schema",
    },
    {
      ...SYNTHETIC_DESCRIPTORS[0].outputSchema,
      $ref: "https://attacker.invalid/schema",
    },
  ];

  for (const outputSchema of maliciousSchemas) {
    const descriptors = SYNTHETIC_DESCRIPTORS.map((descriptor, index) =>
      index === 0 ? { ...descriptor, outputSchema } : descriptor,
    );
    fixture.state.descriptors = descriptors;
    await assert.rejects(
      remoteClient(fixture, {
        expectedDescriptorSha256: descriptorHashes(descriptors),
      }).verifyContract(),
      (error) => {
        assert.equal(error?.code, "REMOTE_DESCRIPTOR_DRIFT");
        assert.ok(!String(error).includes("attacker.invalid"));
        return true;
      },
    );
  }
});

test("performs one project-scoped read with exact protocol metadata and no session", async (t) => {
  const fixture = await startRemoteFixture(t);
  const client = remoteClient(fixture);
  const verified = await client.verifyContract();
  assert.deepEqual(
    verified.discovery._meta["io.modelcontextprotocol/serverInfo"],
    fixtureServerInfo(),
  );
  const result = await client.callTool("trendsfast_project_context_get", {});

  assert.deepEqual(result.structuredContent, {
    ok: true,
    data: {
      source: "synthetic-local-fixture",
      tool: "trendsfast_project_context_get",
    },
  });
  assert.equal(
    result.content[0].text,
    JSON.stringify(result.structuredContent),
  );
  assert.deepEqual(
    fixture.state.requests.map(({ body }) => body.method),
    ["server/discover", "tools/list", "tools/call"],
  );
  for (const request of fixture.state.requests) {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, `Bearer ${SYNTHETIC_BEARER}`);
    assert.equal(
      request.headers["mcp-protocol-version"],
      REMOTE_MCP_PROTOCOL_VERSION,
    );
    assert.equal(request.headers["mcp-method"], request.body.method);
    assert.equal(
      request.body.params._meta["io.modelcontextprotocol/protocolVersion"],
      REMOTE_MCP_PROTOCOL_VERSION,
    );
    assert.deepEqual(
      request.body.params._meta["io.modelcontextprotocol/clientCapabilities"],
      {},
    );
    assert.ok(!JSON.stringify(request.body).includes(SYNTHETIC_BEARER));
  }
  const call = fixture.state.requests[2];
  assert.equal(call.headers["mcp-name"], "trendsfast_project_context_get");
  assert.equal(call.headers["mcp-param-idempotency-key"], undefined);
  assert.deepEqual(call.body.params.arguments, {});
  assert.deepEqual(fixture.state.handlerErrors, []);
});

test("requires exact server identity metadata on discovery, listing, and every call", async (t) => {
  const fixture = await startRemoteFixture(t);

  fixture.state.omitMetadataFor = "server/discover";
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_CONTRACT_DRIFT"),
  );

  fixture.state.omitMetadataFor = null;
  for (const field of ["description", "websiteUrl", "icon"]) {
    fixture.state.driftMetadataFor = "server/discover";
    fixture.state.driftMetadataField = field;
    await assert.rejects(
      remoteClient(fixture).verifyContract(),
      assertTrendsFastCode("REMOTE_CONTRACT_DRIFT"),
    );
  }

  fixture.state.driftMetadataFor = null;
  fixture.state.driftMetadataField = "description";
  fixture.state.omitMetadataFor = "tools/list";
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_CONTRACT_DRIFT"),
  );

  fixture.state.omitMetadataFor = null;
  fixture.state.driftMetadataFor = "tools/list";
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_CONTRACT_DRIFT"),
  );

  fixture.state.driftMetadataFor = null;
  const missingCallMetadata = remoteClient(fixture);
  await missingCallMetadata.verifyContract();
  fixture.state.omitMetadataFor = "tools/call";
  await assert.rejects(
    missingCallMetadata.callTool("trendsfast_project_context_get", {}),
    assertTrendsFastCode("REMOTE_CONTRACT_DRIFT"),
  );

  fixture.state.omitMetadataFor = null;
  const driftedCallMetadata = remoteClient(fixture);
  await driftedCallMetadata.verifyContract();
  fixture.state.driftMetadataFor = "tools/call";
  await assert.rejects(
    driftedCallMetadata.callTool("trendsfast_project_context_get", {}),
    assertTrendsFastCode("REMOTE_CONTRACT_DRIFT"),
  );
});

test("validates exact output schemas and binds isError to success and error envelopes", async (t) => {
  const fixture = await startRemoteFixture(t);
  const client = remoteClient(fixture);
  await client.verifyContract();

  fixture.state.mode = "tool-error";
  const toolError = await client.callTool("trendsfast_project_context_get", {});
  assert.equal(toolError.isError, true);
  assert.deepEqual(toolError.structuredContent, {
    ok: false,
    error: {
      code: "INVALID_TOOL_INPUT",
      message: "The registered tool input is invalid.",
    },
  });

  for (const mode of [
    "inconsistent-success-flag",
    "inconsistent-error-flag",
    "invalid-structured-content",
    "malicious-structured-content",
    "extra-content-block",
    "extra-content-field",
    "extra-result-field",
    "extra-meta-field",
  ]) {
    fixture.state.mode = mode;
    await assert.rejects(
      client.callTool("trendsfast_project_context_get", {}),
      (error) => {
        assert.equal(
          error?.code,
          mode === "extra-meta-field"
            ? "REMOTE_CONTRACT_DRIFT"
            : "REMOTE_PROTOCOL_FAILURE",
        );
        assert.ok(!String(error).includes("must-not-escape"));
        return true;
      },
    );
  }
});

test("rejects redirects and stateless-session drift", async (t) => {
  const fixture = await startRemoteFixture(t);
  fixture.state.mode = "redirect";
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_REDIRECT_REJECTED"),
  );

  fixture.state.mode = "session";
  await assert.rejects(
    remoteClient(fixture).verifyContract(),
    assertTrendsFastCode("REMOTE_PROTOCOL_DRIFT"),
  );
});

test("maps remote errors to bounded public detail", async (t) => {
  const fixture = await startRemoteFixture(t);
  const client = remoteClient(fixture);
  await client.verifyContract();
  fixture.state.mode = "safe-error";
  await assert.rejects(
    client.callTool("trendsfast_project_context_get", {}),
    (error) => {
      assert.equal(error?.code, "RATE_LIMITED");
      assert.equal(error?.message, "The request rate limit was exceeded.");
      assert.equal(error?.retryable, true);
      assert.equal(error?.retryAfterSeconds, 7);
      assert.ok(!String(error).includes("must-not-escape"));
      assert.ok(!String(error).includes(SYNTHETIC_BEARER));
      return true;
    },
  );
});

test("bounds remote response, request, and timeout behavior", async (t) => {
  const fixture = await startRemoteFixture(t);
  fixture.state.mode = "oversized";
  await assert.rejects(
    remoteClient(fixture, { maxResponseBytes: 256 }).verifyContract(),
    assertTrendsFastCode("REMOTE_RESPONSE_TOO_LARGE"),
  );

  fixture.state.mode = "timeout";
  await assert.rejects(
    remoteClient(fixture, { timeoutMs: 20 }).verifyContract(),
    assertTrendsFastCode("REMOTE_TIMEOUT"),
  );

  fixture.state.mode = "body-stall";
  const bodyStallStartedAt = Date.now();
  await assert.rejects(
    remoteClient(fixture, { timeoutMs: 30 }).verifyContract(),
    assertTrendsFastCode("REMOTE_TIMEOUT"),
  );
  assert.ok(Date.now() - bodyStallStartedAt < 1_000);

  const ignoresAbortFetch = async () =>
    new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  await assert.rejects(
    remoteClient(fixture, {
      timeoutMs: 20,
      fetch: ignoresAbortFetch,
    }).verifyContract(),
    assertTrendsFastCode("REMOTE_TIMEOUT"),
  );

  const client = remoteClient(fixture);
  await client.verifyContract();
  const before = fixture.state.requests.length;
  await assert.rejects(
    client.callTool("trendsfast_project_context_get", {
      oversized: "x".repeat(MAX_REMOTE_REQUEST_BYTES),
    }),
    assertTrendsFastCode("INVALID_TOOL_INPUT"),
  );
  assert.equal(fixture.state.requests.length, before);
});

const bridgeChildSource = String.raw`
  import { serveBridge } from "./dist/bridge.js";
  const handle = serveBridge({
    endpoint: process.env.TRENDSFAST_FIXTURE_ENDPOINT,
    apiKey: process.env.TRENDSFAST_FIXTURE_BEARER,
    expectedDescriptorSha256: JSON.parse(process.env.TRENDSFAST_FIXTURE_HASHES),
    onError: (message) => process.stderr.write("bridge: " + message + "\n"),
  });
  globalThis.__trendsfastBridgeHandle = handle;
`;

async function exerciseStdioBridge(t, fixture, mode) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--input-type=module", "--eval", bridgeChildSource],
    cwd: repositoryRoot,
    env: {
      PATH: process.env.PATH ?? "",
      TRENDSFAST_TEST_MODE: "1",
      TRENDSFAST_FIXTURE_ENDPOINT: fixture.endpoint,
      TRENDSFAST_FIXTURE_BEARER: SYNTHETIC_BEARER,
      TRENDSFAST_FIXTURE_HASHES: JSON.stringify(SYNTHETIC_DESCRIPTOR_SHA256),
    },
    stderr: "pipe",
    maxBufferSize: 1_048_576,
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const client = new Client(
    { name: `trendsfast-${mode}-harness`, version: "1.0.0-test" },
    {
      versionNegotiation:
        mode === "modern"
          ? { mode: { pin: REMOTE_MCP_PROTOCOL_VERSION } }
          : { mode: "legacy" },
    },
  );
  t.after(async () => {
    try {
      await client.close();
    } catch {
      await transport.close().catch(() => undefined);
    }
  });

  try {
    await client.connect(transport, { timeout: 5_000 });
    assert.equal(client.getProtocolEra(), mode);
    if (mode === "modern") {
      assert.equal(
        client.getNegotiatedProtocolVersion(),
        REMOTE_MCP_PROTOCOL_VERSION,
      );
      assert.equal(
        client.getDiscoverResult()?.supportedVersions[0],
        REMOTE_MCP_PROTOCOL_VERSION,
      );
    } else {
      assert.match(client.getNegotiatedProtocolVersion() ?? "", /^2025-/u);
      assert.equal(client.getDiscoverResult(), undefined);
    }

    const listed = await client.listTools(undefined, {
      timeout: 5_000,
      cacheMode: "refresh",
    });
    assert.deepEqual(
      listed.tools.map(({ name }) => name),
      [...REMOTE_MCP_TOOL_NAMES],
    );
    const called = await client.callTool(
      { name: "trendsfast_project_context_get", arguments: {} },
      { timeout: 5_000 },
    );
    assert.equal(called.isError, false);
    assert.deepEqual(called.structuredContent, {
      ok: true,
      data: {
        source: "synthetic-local-fixture",
        tool: "trendsfast_project_context_get",
      },
    });
  } catch (error) {
    const diagnostic = Buffer.concat(stderr).toString("utf8");
    throw new Error(
      `Official ${mode} stdio harness failed: ${String(error)}${diagnostic === "" ? "" : `\nstderr:\n${diagnostic}`}`,
      { cause: error },
    );
  }

  const diagnostic = Buffer.concat(stderr).toString("utf8");
  assert.ok(!diagnostic.includes(SYNTHETIC_BEARER));
}

test("official MCP v2 client exercises the local stdio bridge in modern and legacy eras", async (t) => {
  const fixture = await startRemoteFixture(t);
  await t.test("modern 2026-07-28", async (subtest) => {
    await exerciseStdioBridge(subtest, fixture, "modern");
  });
  await t.test("legacy 2025 initialize", async (subtest) => {
    await exerciseStdioBridge(subtest, fixture, "legacy");
  });
  assert.deepEqual(fixture.state.handlerErrors, []);
});
