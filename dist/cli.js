import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { createBridgeBackend, runBridge, } from "./bridge.js";
import { AGENT_SKILL_VERSION, CONTENT_CAPABILITIES, PACKAGE_VERSION, REMOTE_MCP_CONTRACT_VERSION, REMOTE_MCP_PROTOCOL_VERSION, REMOTE_MCP_TOOL_NAMES, } from "./constants.js";
import { readCredential, readInstallState, removeInstallState, resolveConfigPaths, trustedRootForPath, validateInstallPermissions, writeCredential, } from "./config.js";
import { installClientConfigurations, uninstallClientConfigurations, validateInstalledClientConfigurations, } from "./clients.js";
import { configuredEndpoint } from "./endpoint.js";
import { safeErrorMessage, safeRemoteError, TrendsFastError, } from "./errors.js";
import { readRegularFile, removeEmptyDirectory, removeRegularFile, sha256, } from "./files.js";
import { resolvePackageSource, validatePackageSource, } from "./package-source.js";
const COMMANDS = [
    "install",
    "doctor",
    "demo",
    "mcp",
    "uninstall",
    "version",
];
const BOOLEAN_FLAGS = new Set([
    "--dry-run",
    "--json",
    "--create",
    "--yes",
    "--remove-credential",
]);
const VALUE_FLAGS = new Set([
    "--client",
    "--credential-mode",
    "--endpoint",
    "--package-source",
    "--idempotency-key",
    "--objective",
    "--capability",
    "--scan-id",
    "--brief-id",
]);
const REPEATABLE_FLAGS = new Set(["--client", "--capability"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_SCAN_ID = /^[A-Za-z0-9_.-]{1,80}$/u;
const BRIEF_ID_PREFIX = "brief_";
const BRIEF_ID_VERSION = "today-trend-brief-v1";
function briefIdBindsScan(briefId, scanId) {
    if (!briefId.startsWith(BRIEF_ID_PREFIX) || !PUBLIC_SCAN_ID.test(scanId))
        return false;
    try {
        const encoded = briefId.slice(BRIEF_ID_PREFIX.length);
        const decoded = Buffer.from(encoded, "base64url").toString("utf8");
        const expected = `${BRIEF_ID_VERSION}\0${scanId}`;
        return (decoded === expected &&
            Buffer.from(expected, "utf8").toString("base64url") === encoded);
    }
    catch {
        return false;
    }
}
function parseArguments(argv) {
    if (argv.some((argument) => /^--api[-_]?key(?:=|$)/i.test(argument))) {
        throw new TrendsFastError("SECRET_IN_ARGV", "API keys are never accepted in command-line arguments.");
    }
    const command = argv[0];
    if (command === undefined || !COMMANDS.includes(command)) {
        throw new TrendsFastError("INVALID_COMMAND", `Use one command: ${COMMANDS.join(", ")}.`);
    }
    const flags = new Set();
    const values = new Map();
    for (let index = 1; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === undefined ||
            !argument.startsWith("--") ||
            argument.includes("=")) {
            throw new TrendsFastError("INVALID_ARGUMENT", "Use explicit supported flags without positional values.");
        }
        if (BOOLEAN_FLAGS.has(argument)) {
            if (flags.has(argument))
                throw new TrendsFastError("INVALID_ARGUMENT", `Duplicate flag: ${argument}`);
            flags.add(argument);
            continue;
        }
        if (!VALUE_FLAGS.has(argument)) {
            throw new TrendsFastError("INVALID_ARGUMENT", "An unsupported command flag was provided.");
        }
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--") || value.length === 0) {
            throw new TrendsFastError("INVALID_ARGUMENT", `Missing value for ${argument}.`);
        }
        const existing = values.get(argument) ?? [];
        if (!REPEATABLE_FLAGS.has(argument) && existing.length > 0) {
            throw new TrendsFastError("INVALID_ARGUMENT", `Duplicate flag: ${argument}`);
        }
        existing.push(value);
        values.set(argument, existing);
        index += 1;
    }
    return { command: command, flags, values };
}
function one(parsed, name) {
    return parsed.values.get(name)?.[0];
}
function many(parsed, name) {
    return parsed.values.get(name) ?? [];
}
function rejectFlags(parsed, allowed) {
    const allowedSet = new Set(allowed);
    for (const flag of [...parsed.flags, ...parsed.values.keys()]) {
        if (!allowedSet.has(flag)) {
            throw new TrendsFastError("INVALID_ARGUMENT", `${flag} is not valid for ${parsed.command}.`);
        }
    }
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
    return JSON.stringify(value) ?? "undefined";
}
function unwrapResult(result) {
    if (!isObject(result.structuredContent)) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The tool result was not a structured object.");
    }
    const envelope = result.structuredContent;
    if (result.isError !== (envelope.ok === false)) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The tool error signal did not match its structured envelope.");
    }
    if (envelope.ok === true && isObject(envelope.data))
        return envelope.data;
    if (envelope.ok === false && isObject(envelope.error)) {
        throw safeRemoteError(envelope.error.version, envelope.error.code, envelope.error.retryable, envelope.error.retry_after_seconds);
    }
    throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The tool result envelope was malformed.");
}
function selectedBriefIsVideo(brief) {
    if (isObject(brief.content_play))
        return brief.content_play.format === "VIDEO";
    return (isObject(brief.recommended_asset) &&
        brief.recommended_asset.format === "VIDEO");
}
function outputJson(stdout, value) {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function selectedCredentialMode(state) {
    if (state === null || state.clients.length === 0)
        return "environment";
    const modes = [
        ...new Set(state.clients.map((record) => record.credentialMode)),
    ];
    if (modes.length !== 1 || modes[0] === undefined) {
        throw new TrendsFastError("INVALID_CONFIG", "Installed client credential modes are inconsistent.");
    }
    return modes[0];
}
function configPathOptions(dependencies, env) {
    return {
        env,
        ...(dependencies.homeDir === undefined
            ? {}
            : { homeDir: dependencies.homeDir }),
    };
}
async function hiddenInputDefault(prompt, stdin, stderr) {
    const tty = stdin;
    if (!tty.isTTY || typeof tty.setRawMode !== "function") {
        throw new TrendsFastError("CREDENTIAL_REQUIRED", "Set TRENDSFAST_API_KEY in the inherited environment for non-interactive installation.");
    }
    stderr.write(prompt);
    tty.setRawMode(true);
    tty.resume();
    let value = "";
    try {
        return await new Promise((resolve, reject) => {
            const onData = (chunk) => {
                const text = String(chunk);
                for (const character of text) {
                    if (character === "\u0003") {
                        cleanup();
                        reject(new TrendsFastError("CANCELLED", "Installation was cancelled."));
                        return;
                    }
                    if (character === "\r" || character === "\n") {
                        cleanup();
                        stderr.write("\n");
                        resolve(value);
                        return;
                    }
                    if (character === "\u007f" || character === "\b")
                        value = value.slice(0, -1);
                    else if (character >= " " && value.length < 2048)
                        value += character;
                }
            };
            const cleanup = () => {
                tty.off("data", onData);
                tty.setRawMode(false);
                tty.pause();
            };
            tty.on("data", onData);
        });
    }
    finally {
        if (tty.isRaw)
            tty.setRawMode(false);
    }
}
async function confirmDefault(prompt, stdin, stderr) {
    const tty = stdin;
    if (!tty.isTTY) {
        throw new TrendsFastError("CONFIRMATION_REQUIRED", "Use --yes only after reviewing the billable-create warning.");
    }
    const reader = createInterface({
        input: stdin,
        output: stderr,
        terminal: true,
    });
    try {
        return (await reader.question(prompt)).trim() === "CREATE";
    }
    finally {
        reader.close();
    }
}
async function selectClientsDefault(stdin, stderr) {
    const tty = stdin;
    if (!tty.isTTY) {
        throw new TrendsFastError("CLIENT_REQUIRED", "Select clients non-interactively with --client generic, --client claude-code, or --client codex.");
    }
    const reader = createInterface({
        input: stdin,
        output: stderr,
        terminal: true,
    });
    try {
        const answer = await reader.question("Clients to configure (comma-separated: generic, claude-code, codex): ");
        return answer
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }
    finally {
        reader.close();
    }
}
function toConfigClient(value) {
    if (value === "generic")
        return "generic";
    if (value === "claude-code")
        return "claude";
    if (value === "codex")
        return "codex";
    throw new TrendsFastError("UNSUPPORTED_CLIENT", "Supported clients are generic, claude-code, and codex.");
}
async function backendFromConfig(dependencies) {
    if (dependencies.backend !== undefined && dependencies.homeDir === undefined)
        return { backend: dependencies.backend, state: null };
    const env = dependencies.env ?? process.env;
    const paths = resolveConfigPaths(configPathOptions(dependencies, env));
    const state = await readInstallState(paths);
    if (state === null) {
        throw new TrendsFastError("INSTALL_REQUIRED", "Run the secure TrendsFast install command before using the live client.");
    }
    await validateInstallPermissions(paths, state);
    if (state.protocolVersion !== REMOTE_MCP_PROTOCOL_VERSION ||
        state.packageVersion !== PACKAGE_VERSION ||
        state.clients.length === 0 ||
        state.skills.length !== state.clients.length ||
        configuredEndpoint(state.endpoint).href !== state.endpoint) {
        throw new TrendsFastError("INVALID_CONFIG", "The local TrendsFast install identity is stale or incomplete.");
    }
    await validateInstalledClientConfigurations({ paths, state });
    const mode = selectedCredentialMode(state);
    const apiKey = await readCredential({ mode, paths, env });
    const endpoint = configuredEndpoint(state?.endpoint).href;
    if (dependencies.backend !== undefined) {
        return { backend: dependencies.backend, state };
    }
    const backend = await createBridgeBackend({
        endpoint,
        apiKey,
        ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    });
    return { backend, state };
}
async function installCommand(parsed, dependencies) {
    rejectFlags(parsed, [
        "--client",
        "--credential-mode",
        "--endpoint",
        "--package-source",
        "--dry-run",
        "--yes",
    ]);
    const stdout = dependencies.stdout ?? process.stdout;
    const stderr = dependencies.stderr ?? process.stderr;
    const stdin = dependencies.stdin ?? process.stdin;
    const env = dependencies.env ?? process.env;
    let requestedClients = many(parsed, "--client");
    const dryRun = parsed.flags.has("--dry-run");
    if (requestedClients.length === 0) {
        requestedClients = dryRun
            ? ["generic"]
            : await (dependencies.selectClients ??
                (() => selectClientsDefault(stdin, stderr)))();
    }
    if (requestedClients.length === 0)
        throw new TrendsFastError("CLIENT_REQUIRED", "Select at least one exact client.");
    const clients = [...new Set(requestedClients.map(toConfigClient))];
    const rawMode = one(parsed, "--credential-mode") ?? "env";
    const credentialMode = rawMode === "env"
        ? "environment"
        : rawMode === "file"
            ? "file"
            : (() => {
                throw new TrendsFastError("INVALID_CREDENTIAL_MODE", "Use --credential-mode env or file.");
            })();
    const endpoint = configuredEndpoint(one(parsed, "--endpoint")).href;
    const packageSource = one(parsed, "--package-source") === undefined
        ? resolvePackageSource(env)
        : validatePackageSource(one(parsed, "--package-source"));
    const paths = resolveConfigPaths(configPathOptions(dependencies, env));
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const skillBytes = await readRegularFile(resolve(packageRoot, "skills", "trendsfast", "SKILL.md"));
    if (skillBytes === null)
        throw new TrendsFastError("PACKAGE_INVALID", "The packaged TrendsFast skill is missing.");
    const installOptions = {
        paths,
        clients,
        packageSource,
        credentialMode,
        endpoint,
        protocolVersion: REMOTE_MCP_PROTOCOL_VERSION,
        packageVersion: PACKAGE_VERSION,
        skillBytes,
    };
    let credentialCreatedSha256 = null;
    if (credentialMode === "environment" && !dryRun) {
        await readCredential({ mode: "environment", paths, env });
    }
    if (credentialMode === "file" && !dryRun) {
        const apiKey = env.TRENDSFAST_API_KEY ??
            (await (dependencies.hiddenInput ??
                ((prompt) => hiddenInputDefault(prompt, stdin, stderr)))("TrendsFast project API key (hidden): "));
        if (!parsed.flags.has("--yes")) {
            throw new TrendsFastError("CREDENTIAL_CONSENT_REQUIRED", "Protected-file mode requires --yes after explicit consent to store the credential.");
        }
        // Validate every client and skill target before persisting the credential.
        await installClientConfigurations({ ...installOptions, dryRun: true });
        const existingCredential = await readRegularFile(paths.credentialFile, trustedRootForPath(paths, paths.credentialFile));
        if (existingCredential !== null) {
            const existingValue = await readCredential({ mode: "file", paths, env });
            if (existingValue !== apiKey) {
                throw new TrendsFastError("CREDENTIAL_CONFLICT", "A different protected credential already exists; remove it explicitly before replacement.");
            }
        }
        else {
            await writeCredential({ paths, apiKey, consent: true });
            credentialCreatedSha256 = sha256(Buffer.from(`${apiKey}\n`));
            await dependencies.afterCredentialWrite?.();
        }
    }
    let state;
    try {
        state = await installClientConfigurations({ ...installOptions, dryRun });
    }
    catch (error) {
        if (credentialCreatedSha256 !== null)
            await removeRegularFile(paths.credentialFile, false, credentialCreatedSha256, trustedRootForPath(paths, paths.credentialFile)).catch(() => undefined);
        throw error;
    }
    outputJson(stdout, {
        command: "install",
        dry_run: dryRun,
        installed: !dryRun,
        package_source: packageSource,
        package_version: PACKAGE_VERSION,
        endpoint,
        clients: state.clients.map((record) => record.client === "claude" ? "claude-code" : record.client),
        config_paths: state.clients.map((record) => record.configPath),
        skill_paths: state.skills.map((record) => record.path),
        credential_mode: rawMode,
        credential_path: credentialMode === "file" ? paths.credentialFile : null,
        first_read_only_command: `npx -y ${packageSource} doctor --json`,
        first_read_only_argv: ["npx", "-y", packageSource, "doctor", "--json"],
        auto_publish: false,
        scheduling: false,
        ...(dryRun && many(parsed, "--client").length === 0
            ? { dry_run_default_client: "generic" }
            : {}),
    });
}
async function doctorCommand(parsed, dependencies) {
    rejectFlags(parsed, ["--json"]);
    const stdout = dependencies.stdout ?? process.stdout;
    const { backend } = await backendFromConfig(dependencies);
    const checks = [
        { name: "server_discovery", status: "PASS" },
        { name: "tools_list_exact_seven", status: "PASS" },
    ];
    if (backend.tools.map((tool) => tool.name).join("\0") !==
        REMOTE_MCP_TOOL_NAMES.join("\0")) {
        throw new TrendsFastError("REMOTE_DESCRIPTOR_DRIFT", "The verified bridge inventory changed.");
    }
    for (const [name, tool] of [
        ["project_context", "trendsfast_project_context_get"],
        ["latest", "trendsfast_brief_latest_get"],
        ["sources", "trendsfast_sources_get"],
    ]) {
        unwrapResult(await backend.callTool(tool));
        checks.push({ name, status: "PASS" });
    }
    const result = {
        command: "doctor",
        status: "PASS",
        checks,
        read_only: true,
        scans_created: 0,
        provider_calls: 0,
        model_calls: 0,
    };
    if (parsed.flags.has("--json"))
        outputJson(stdout, result);
    else
        stdout.write("TrendsFast doctor: PASS (discovery, 7 tools, context, latest, sources; read-only)\n");
}
async function maybeHandoff(backend, brief) {
    if (!selectedBriefIsVideo(brief))
        return null;
    const briefId = brief.brief_id;
    if (typeof briefId !== "string") {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "A video brief did not expose its immutable brief ID.");
    }
    return unwrapResult(await backend.callTool("trendsfast_creative_handoff_get", {
        brief_id: briefId,
    }));
}
async function readOnlyDemo(parsed, backend, stdout) {
    const context = unwrapResult(await backend.callTool("trendsfast_project_context_get"));
    const latest = unwrapResult(await backend.callTool("trendsfast_brief_latest_get"));
    const scanId = one(parsed, "--scan-id");
    const existingStatus = scanId === undefined
        ? null
        : unwrapResult(await backend.callTool("trendsfast_today_status_get", {
            scan_id: scanId,
        }));
    const briefId = one(parsed, "--brief-id");
    const historicalBrief = briefId === undefined
        ? null
        : unwrapResult(await backend.callTool("trendsfast_brief_get", { brief_id: briefId }));
    const handoff = await maybeHandoff(backend, historicalBrief ?? latest);
    outputJson(stdout, {
        command: "demo",
        mode: "read_only",
        context,
        existing_status: existingStatus,
        latest,
        historical_brief: historicalBrief,
        creative_handoff: handoff,
        scans_created: 0,
        auto_publish: false,
        scheduling: false,
    });
}
async function createDemo(parsed, backend, dependencies) {
    const stdout = dependencies.stdout ?? process.stdout;
    const stderr = dependencies.stderr ?? process.stderr;
    const stdin = dependencies.stdin ?? process.stdin;
    const key = one(parsed, "--idempotency-key");
    if (key === undefined || !UUID_V4.test(key)) {
        throw new TrendsFastError("INVALID_IDEMPOTENCY_KEY", "--idempotency-key must be an explicit UUID v4.");
    }
    const objective = one(parsed, "--objective");
    if (objective === undefined ||
        objective.trim() !== objective ||
        objective.length > 100) {
        throw new TrendsFastError("INVALID_OBJECTIVE", "--objective must be explicit and between 1 and 100 characters.");
    }
    const requestedCapabilities = many(parsed, "--capability");
    if (requestedCapabilities.length === 0 ||
        new Set(requestedCapabilities).size !== requestedCapabilities.length) {
        throw new TrendsFastError("INVALID_CAPABILITY", "Provide one or more unique --capability values.");
    }
    for (const capability of requestedCapabilities) {
        if (!CONTENT_CAPABILITIES.includes(capability)) {
            throw new TrendsFastError("INVALID_CAPABILITY", "A supplied content capability is outside the public allowlist.");
        }
    }
    stderr.write("Warning: --create starts one billable TrendsFast scan. It never approves, delivers, publishes, or schedules.\n");
    if (!parsed.flags.has("--yes")) {
        const confirmed = await (dependencies.confirm ??
            ((prompt) => confirmDefault(prompt, stdin, stderr)))("Type CREATE to confirm one billable scan: ");
        if (!confirmed)
            throw new TrendsFastError("CANCELLED", "The billable scan was not confirmed.");
    }
    const context = unwrapResult(await backend.callTool("trendsfast_project_context_get"));
    const projectId = context.project_id;
    const contextVersion = context.context_version;
    if (typeof projectId !== "string" ||
        projectId.length === 0 ||
        typeof contextVersion !== "string" ||
        contextVersion.length === 0) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The project context did not expose its exact identity.");
    }
    const createArguments = {
        intent: "CREATE_TODAYS_TREND_BRIEF",
        idempotency_key: key,
        request: {
            objective,
            content_capabilities: requestedCapabilities,
            generation_level: "draft",
            creative_mode: "none",
        },
    };
    // Intentionally exactly one invocation. Ambiguous transport outcomes are never retried.
    const admission = unwrapResult(await backend.callTool("trendsfast_today_create", createArguments));
    const scanId = typeof admission.scan_id === "string" ? admission.scan_id : null;
    if (scanId === null) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The accepted create result did not include a scan ID.");
    }
    const sleep = dependencies.sleep ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    let status = {
        status: admission.status,
        poll_after_seconds: admission.poll_after_seconds,
    };
    for (let polls = 0; polls < 120; polls += 1) {
        const lifecycle = status.status;
        if (["REVIEW_REQUIRED", "READY", "FAILED"].includes(String(lifecycle)))
            break;
        const delay = status.poll_after_seconds;
        if (delay !== 30) {
            throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "A running scan returned invalid poll timing.");
        }
        await sleep(delay * 1000);
        status = unwrapResult(await backend.callTool("trendsfast_today_status_get", {
            scan_id: scanId,
        }));
    }
    if (!["REVIEW_REQUIRED", "READY", "FAILED"].includes(String(status.status))) {
        throw new TrendsFastError("REMOTE_TIMEOUT", "The scan did not reach a terminal review state within the bounded poll window.");
    }
    if (status.status === "FAILED") {
        outputJson(stdout, { command: "demo", mode: "create", admission, status });
        throw new TrendsFastError("SCAN_FAILED", "The scan reached terminal FAILED; it was not retried.");
    }
    const latest = unwrapResult(await backend.callTool("trendsfast_brief_latest_get"));
    const briefId = typeof latest.brief_id === "string" ? latest.brief_id : null;
    if (briefId === null) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The completed brief did not expose its immutable identity.");
    }
    if (!briefIdBindsScan(briefId, scanId)) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The completed brief identity did not bind to the accepted scan.");
    }
    const brief = unwrapResult(await backend.callTool("trendsfast_brief_get", { brief_id: briefId }));
    if (canonicalJson(brief) !== canonicalJson(latest)) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The latest brief did not match its immutable brief read.");
    }
    const handoffData = isObject(brief.agent_handoff)
        ? brief.agent_handoff
        : null;
    const confirmedCapabilities = handoffData?.content_capabilities;
    if (brief.project_id !== projectId ||
        brief.project_context_version_id !== contextVersion ||
        brief.objective !== objective ||
        (brief.lifecycle_state !== undefined &&
            brief.lifecycle_state !== status.status) ||
        !Array.isArray(confirmedCapabilities) ||
        confirmedCapabilities.some((value) => typeof value !== "string") ||
        [...confirmedCapabilities].sort().join("\0") !==
            [...requestedCapabilities].sort().join("\0")) {
        throw new TrendsFastError("REMOTE_PROTOCOL_FAILURE", "The completed brief did not bind to the requested project, context, lifecycle, objective, and capabilities.");
    }
    const sources = unwrapResult(await backend.callTool("trendsfast_sources_get"));
    const handoff = await maybeHandoff(backend, brief);
    outputJson(stdout, {
        command: "demo",
        mode: "create",
        idempotency_key: key,
        admission,
        status,
        brief,
        sources,
        creative_handoff: handoff,
        create_calls: 1,
        approved: false,
        delivered: false,
        published: false,
        scheduled: false,
    });
}
async function demoCommand(parsed, dependencies) {
    rejectFlags(parsed, [
        "--create",
        "--yes",
        "--idempotency-key",
        "--objective",
        "--capability",
        "--scan-id",
        "--brief-id",
    ]);
    const stdout = dependencies.stdout ?? process.stdout;
    const { backend } = await backendFromConfig(dependencies);
    if (!parsed.flags.has("--create")) {
        if (one(parsed, "--idempotency-key") !== undefined ||
            one(parsed, "--objective") !== undefined ||
            many(parsed, "--capability").length > 0 ||
            parsed.flags.has("--yes")) {
            throw new TrendsFastError("CREATE_FLAG_REQUIRED", "Create inputs require the explicit --create flag.");
        }
        await readOnlyDemo(parsed, backend, stdout);
        return;
    }
    if (one(parsed, "--scan-id") !== undefined ||
        one(parsed, "--brief-id") !== undefined) {
        throw new TrendsFastError("INVALID_ARGUMENT", "Historical read flags cannot be combined with --create.");
    }
    await createDemo(parsed, backend, dependencies);
}
async function mcpCommand(parsed, dependencies) {
    rejectFlags(parsed, []);
    const env = dependencies.env ?? process.env;
    const paths = resolveConfigPaths(configPathOptions(dependencies, env));
    const state = await readInstallState(paths);
    await validateInstallPermissions(paths, state);
    const mode = selectedCredentialMode(state);
    const apiKey = await readCredential({ mode, paths, env });
    await runBridge({
        endpoint: configuredEndpoint(state?.endpoint).href,
        apiKey,
        ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
        onError: (message) => (dependencies.stderr ?? process.stderr).write(`trendsfast: ${message}\n`),
    });
}
async function uninstallCommand(parsed, dependencies) {
    rejectFlags(parsed, ["--dry-run", "--remove-credential"]);
    const stdout = dependencies.stdout ?? process.stdout;
    const env = dependencies.env ?? process.env;
    const paths = resolveConfigPaths(configPathOptions(dependencies, env));
    const state = await readInstallState(paths);
    const dryRun = parsed.flags.has("--dry-run");
    if (state !== null)
        await uninstallClientConfigurations({ paths, state, dryRun });
    else
        await removeInstallState(paths, dryRun);
    if (parsed.flags.has("--remove-credential"))
        await removeRegularFile(paths.credentialFile, dryRun, undefined, trustedRootForPath(paths, paths.credentialFile));
    const installedSkillDirectories = state?.skills.map((record) => dirname(record.path)) ?? [];
    const genericSelected = state?.skills.some((record) => record.client === "generic");
    for (const directory of [
        ...installedSkillDirectories,
        ...(genericSelected ? [dirname(dirname(paths.genericSkill))] : []),
        paths.backupsDir,
        paths.configDir,
    ]) {
        await removeEmptyDirectory(directory, dryRun, trustedRootForPath(paths, directory));
    }
    outputJson(stdout, {
        command: "uninstall",
        dry_run: dryRun,
        removed_managed_entries: state?.clients.length ?? 0,
        removed_managed_skills: state?.skills.length ?? 0,
        credential_removed: parsed.flags.has("--remove-credential") && !dryRun,
        unrelated_entries_preserved: true,
    });
}
function versionCommand(parsed, stdout) {
    rejectFlags(parsed, []);
    stdout.write(`package_version=${PACKAGE_VERSION}\n` +
        `agent_skill_version=${AGENT_SKILL_VERSION}\n` +
        `mcp_contract_version=${REMOTE_MCP_CONTRACT_VERSION}\n` +
        `mcp_protocol_version=${REMOTE_MCP_PROTOCOL_VERSION}\n`);
}
export function createIdempotencyKey() {
    return randomUUID();
}
function normalizedDoctorError(error) {
    if (error instanceof TrendsFastError)
        return error;
    return new TrendsFastError("LOCAL_INSTALL_INVALID", "The local TrendsFast install could not be verified. Uninstall and reinstall it before retrying Doctor.", { cause: error });
}
function outputDoctorFailure(stdout, error) {
    outputJson(stdout, {
        command: "doctor",
        status: "FAIL",
        checks: [{ name: "doctor_acceptance", status: "FAIL" }],
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            retry_after_seconds: error.retryAfterSeconds,
        },
        read_only: true,
        scans_created: 0,
        provider_calls: 0,
        model_calls: 0,
    });
}
export async function runCli(argv, dependencies = {}) {
    const parsed = parseArguments(argv);
    switch (parsed.command) {
        case "install":
            await installCommand(parsed, dependencies);
            break;
        case "doctor":
            try {
                await doctorCommand(parsed, dependencies);
            }
            catch (error) {
                const normalized = normalizedDoctorError(error);
                if (parsed.flags.has("--json")) {
                    outputDoctorFailure(dependencies.stdout ?? process.stdout, normalized);
                }
                throw normalized;
            }
            break;
        case "demo":
            await demoCommand(parsed, dependencies);
            break;
        case "mcp":
            await mcpCommand(parsed, dependencies);
            break;
        case "uninstall":
            await uninstallCommand(parsed, dependencies);
            break;
        case "version":
            versionCommand(parsed, dependencies.stdout ?? process.stdout);
            break;
    }
}
export function formatCliError(error) {
    return safeErrorMessage(error);
}
