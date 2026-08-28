import { basename, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { API_KEY_ENV, readInstallStateSnapshot, removeInstallState, validateInstallPermissions, validateInstallStatePaths, trustedRootForPath, writeInstallState, } from "./config.js";
import { atomicWriteFile, ensurePrivateDirectory, readRegularFile, removeRegularFile, sha256, writeByteExactBackup, } from "./files.js";
import { validatePackageSource } from "./package-source.js";
const ENTRY_ID = "trendsfast";
const CODEX_BLOCK_BEGIN = "# >>> trendsfast-agent managed entry >>>";
const CODEX_BLOCK_END = "# <<< trendsfast-agent managed entry <<<";
function readManaged(paths, path) {
    return readRegularFile(path, trustedRootForPath(paths, path));
}
function ensureManagedDirectory(paths, path, dryRun) {
    return ensurePrivateDirectory(path, dryRun, trustedRootForPath(paths, path));
}
function atomicManagedWrite(paths, path, bytes, options = {}) {
    return atomicWriteFile(path, bytes, {
        ...options,
        trustedRoot: trustedRootForPath(paths, path),
    });
}
function removeManagedFile(paths, path, dryRun = false, expectedSha256) {
    return removeRegularFile(path, dryRun, expectedSha256, trustedRootForPath(paths, path));
}
function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function rejectDangerousKeys(value) {
    if (Array.isArray(value))
        return value.forEach(rejectDangerousKeys);
    if (!isPlainObject(value))
        return;
    for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
            throw new Error("Ambiguous configuration key.");
        rejectDangerousKeys(child);
    }
}
function normalizedDecimal(value) {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(value);
    if (match === null || value.length > 1_000)
        throw new Error("A JSON number cannot be represented losslessly.");
    const [, sign = "", whole = "", fraction = "", exponentText = "0"] = match;
    const parsedExponent = Number(exponentText);
    if (!Number.isSafeInteger(parsedExponent))
        throw new Error("A JSON number cannot be represented losslessly.");
    let coefficient = BigInt(`${sign}${whole}${fraction}`);
    let exponent = parsedExponent - fraction.length;
    if (coefficient === 0n)
        return "0e0";
    while (coefficient % 10n === 0n) {
        coefficient /= 10n;
        exponent += 1;
    }
    return `${coefficient}e${exponent}`;
}
function assertLosslessJsonNumber(token) {
    const parsed = Number(token);
    if (!Number.isFinite(parsed) || Object.is(parsed, -0))
        throw new Error("A JSON number cannot be represented losslessly.");
    const rendered = JSON.stringify(parsed);
    if (rendered === undefined ||
        normalizedDecimal(token) !== normalizedDecimal(rendered)) {
        throw new Error("A JSON number cannot be represented losslessly.");
    }
}
function assertNoDuplicateJsonKeys(text) {
    let index = 0;
    const whitespace = () => {
        while (/\s/u.test(text[index] ?? ""))
            index += 1;
    };
    const string = () => {
        const start = index++;
        while (index < text.length) {
            if (text[index] === "\\") {
                index += 2;
                continue;
            }
            if (text[index++] === '"')
                return JSON.parse(text.slice(start, index));
        }
        throw new Error("Invalid JSON configuration.");
    };
    const value = () => {
        whitespace();
        if (text[index] === "{") {
            index += 1;
            whitespace();
            const keys = new Set();
            if (text[index] === "}") {
                index += 1;
                return;
            }
            while (true) {
                whitespace();
                if (text[index] !== '"')
                    throw new Error("Invalid JSON configuration.");
                const key = string();
                if (keys.has(key))
                    throw new Error(`Duplicate JSON key: ${key}`);
                keys.add(key);
                whitespace();
                if (text[index++] !== ":")
                    throw new Error("Invalid JSON configuration.");
                value();
                whitespace();
                if (text[index] === "}") {
                    index += 1;
                    return;
                }
                if (text[index++] !== ",")
                    throw new Error("Invalid JSON configuration.");
            }
        }
        if (text[index] === "[") {
            index += 1;
            whitespace();
            if (text[index] === "]") {
                index += 1;
                return;
            }
            while (true) {
                value();
                whitespace();
                if (text[index] === "]") {
                    index += 1;
                    return;
                }
                if (text[index++] !== ",")
                    throw new Error("Invalid JSON configuration.");
            }
        }
        if (text[index] === '"') {
            string();
            return;
        }
        const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(index));
        if (!match)
            throw new Error("Invalid JSON configuration.");
        if (!["true", "false", "null"].includes(match[0]))
            assertLosslessJsonNumber(match[0]);
        index += match[0].length;
    };
    value();
    whitespace();
    if (index !== text.length)
        throw new Error("Invalid JSON configuration.");
}
export function parseStrictJson(text) {
    assertNoDuplicateJsonKeys(text);
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed))
        throw new Error("Client configuration must be a JSON object.");
    rejectDangerousKeys(parsed);
    return parsed;
}
export function parseStrictToml(text) {
    let parsed;
    try {
        parsed = parseToml(text);
    }
    catch {
        throw new Error("Client configuration is not valid TOML.");
    }
    if (!isPlainObject(parsed))
        throw new Error("Client configuration must be a TOML table.");
    rejectDangerousKeys(parsed);
    return parsed;
}
export function assertPackageSource(source) {
    validatePackageSource(source);
}
export function jsonClientEntry(packageSource, mode) {
    assertPackageSource(packageSource);
    return {
        command: "npx",
        args: ["-y", packageSource, "mcp"],
        ...(mode === "environment"
            ? { env: { [API_KEY_ENV]: `\${${API_KEY_ENV}}` } }
            : {}),
    };
}
export function codexClientEntry(packageSource, mode) {
    assertPackageSource(packageSource);
    return {
        command: "npx",
        args: ["-y", packageSource, "mcp"],
        ...(mode === "environment" ? { env_vars: [API_KEY_ENV] } : {}),
        default_tools_approval_mode: "writes",
    };
}
function equal(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
export function updateJsonClient(text, packageSource, mode) {
    const root = text === null ? {} : parseStrictJson(text);
    const existingServers = root.mcpServers;
    if (existingServers !== undefined && !isPlainObject(existingServers))
        throw new Error("Ambiguous mcpServers configuration.");
    const servers = existingServers ?? {};
    const entry = jsonClientEntry(packageSource, mode);
    if (ENTRY_ID in servers && !equal(servers[ENTRY_ID], entry))
        throw new Error("Conflicting TrendsFast client entry.");
    servers[ENTRY_ID] = entry;
    root.mcpServers = servers;
    return JSON.stringify(root, null, 2) + "\n";
}
export function updateCodexClient(text, packageSource, mode) {
    const original = text ?? "";
    const root = original === "" ? {} : parseStrictToml(original);
    const existingServers = root.mcp_servers;
    if (existingServers !== undefined && !isPlainObject(existingServers))
        throw new Error("Ambiguous mcp_servers configuration.");
    const entry = codexClientEntry(packageSource, mode);
    if (existingServers !== undefined && ENTRY_ID in existingServers) {
        if (!equal(existingServers[ENTRY_ID], entry) ||
            !original.includes(CODEX_BLOCK_BEGIN)) {
            throw new Error("Conflicting TrendsFast client entry.");
        }
        return original;
    }
    if (original.includes(CODEX_BLOCK_BEGIN) ||
        original.includes(CODEX_BLOCK_END)) {
        throw new Error("Ambiguous TrendsFast managed marker.");
    }
    const separator = original === "" || original.endsWith("\n") ? "" : "\n";
    const leading = original === "" ? "" : "\n";
    return `${original}${separator}${leading}${renderCodexBlock(packageSource, mode)}`;
}
function renderCodexBlock(packageSource, mode) {
    const escaped = JSON.stringify(packageSource);
    return (`${CODEX_BLOCK_BEGIN}\n` +
        `[mcp_servers.trendsfast]\n` +
        `command = "npx"\n` +
        `args = ["-y", ${escaped}, "mcp"]\n` +
        (mode === "environment" ? `env_vars = ["${API_KEY_ENV}"]\n` : "") +
        `default_tools_approval_mode = "writes"\n` +
        `${CODEX_BLOCK_END}\n`);
}
function hasClientEntry(client, bytes) {
    const root = client === "codex"
        ? parseStrictToml(bytes.toString("utf8"))
        : parseStrictJson(bytes.toString("utf8"));
    const servers = root[client === "codex" ? "mcp_servers" : "mcpServers"];
    if (servers === undefined)
        return false;
    if (!isPlainObject(servers))
        throw new Error("Ambiguous MCP client configuration.");
    return ENTRY_ID in servers;
}
function clientPath(paths, client) {
    return client === "claude"
        ? paths.claudeConfig
        : client === "codex"
            ? paths.codexConfig
            : paths.genericConfig;
}
function skillPath(paths, client) {
    return client === "claude"
        ? paths.claudeSkill
        : client === "codex"
            ? paths.codexSkill
            : paths.genericSkill;
}
function render(client, existing, source, mode) {
    const text = existing?.toString("utf8") ?? null;
    return Buffer.from(client === "codex"
        ? updateCodexClient(text, source, mode)
        : updateJsonClient(text, source, mode));
}
export async function installClientConfigurations(options) {
    assertPackageSource(options.packageSource);
    await ensureManagedDirectory(options.paths, options.paths.configDir, options.dryRun ?? false);
    const unique = [...new Set(options.clients)];
    const previousSnapshot = await readInstallStateSnapshot(options.paths);
    const previousState = previousSnapshot?.state ?? null;
    await validateInstallPermissions(options.paths, previousState);
    if (previousState !== null) {
        const previousClients = previousState.clients
            .map((record) => record.client)
            .sort()
            .join("\0");
        const selectedClients = [...unique].sort().join("\0");
        if (selectedClients !== previousClients) {
            throw new Error("The installed client selection cannot be changed in place; uninstall first.");
        }
    }
    const clientPlans = [];
    const skillPlans = [];
    // Parse and validate every target before changing any target.
    for (const client of unique) {
        const path = clientPath(options.paths, client);
        const existing = await readManaged(options.paths, path);
        const managedPrevious = previousState?.clients.find((record) => record.client === client && record.configPath === path);
        if (managedPrevious !== undefined && existing === null) {
            throw new Error(`The previously managed ${client} configuration is missing.`);
        }
        if (managedPrevious !== undefined &&
            existing !== null &&
            sha256(existing) !== managedPrevious.installedSha256) {
            throw new Error(`The managed ${client} configuration changed after installation; uninstall first to preserve unrelated edits.`);
        }
        if (managedPrevious === undefined &&
            existing !== null &&
            hasClientEntry(client, existing)) {
            throw new Error(`An unmanaged TrendsFast entry already exists for ${client}.`);
        }
        const base = managedPrevious === undefined || existing === null
            ? existing
            : removeEntry(client, existing, managedPrevious.client === "codex"
                ? codexClientEntry(managedPrevious.packageSource, managedPrevious.credentialMode)
                : jsonClientEntry(managedPrevious.packageSource, managedPrevious.credentialMode));
        const installed = render(client, base, options.packageSource, options.credentialMode);
        const backupPath = managedPrevious?.backupPath ??
            (existing
                ? join(options.paths.backupsDir, `${client}-${sha256(Buffer.from(path)).slice(0, 16)}-${sha256(existing)}.bak`)
                : null);
        clientPlans.push({
            path,
            existing,
            existingSha256: existing === null ? null : sha256(existing),
            installed,
            needsBackup: managedPrevious === undefined &&
                existing !== null &&
                !existing.equals(installed),
            record: {
                client,
                configPath: path,
                backupPath,
                originalExisted: managedPrevious?.originalExisted ?? Boolean(existing),
                installedSha256: sha256(installed),
                packageSource: options.packageSource,
                credentialMode: options.credentialMode,
            },
        });
        if (options.skillBytes !== undefined) {
            const installedSkill = options.skillBytes;
            const target = skillPath(options.paths, client);
            const existingSkill = await readManaged(options.paths, target);
            const previousSkill = previousState?.skills.find((record) => record.client === client &&
                record.path === target &&
                existingSkill !== null &&
                sha256(existingSkill) === record.installedSha256);
            if (existingSkill !== null && previousSkill === undefined) {
                throw new Error(`An unmanaged TrendsFast skill already exists for ${client}.`);
            }
            skillPlans.push({
                path: target,
                existing: existingSkill,
                existingSha256: existingSkill === null ? null : sha256(existingSkill),
                installed: installedSkill,
                record: {
                    client,
                    path: target,
                    installedSha256: sha256(installedSkill),
                },
            });
        }
    }
    const state = {
        schemaVersion: 1,
        endpoint: options.endpoint,
        protocolVersion: options.protocolVersion,
        packageVersion: options.packageVersion,
        clients: clientPlans.map((plan) => plan.record),
        skills: skillPlans.map((plan) => plan.record),
    };
    const changed = [];
    try {
        await options.beforeCommit?.();
        for (const plan of clientPlans) {
            if (plan.existing && plan.needsBackup) {
                await ensureManagedDirectory(options.paths, options.paths.backupsDir, options.dryRun ?? false);
                const backupPath = plan.record.backupPath;
                await writeByteExactBackup(backupPath, plan.existing, options.dryRun ?? false, trustedRootForPath(options.paths, backupPath));
            }
            if (plan.existing?.equals(plan.installed))
                continue;
            await atomicManagedWrite(options.paths, plan.path, plan.installed, {
                preserveMode: plan.existing !== null,
                mode: 0o600,
                dryRun: options.dryRun ?? false,
                expectedSha256: plan.existingSha256,
            });
            if (!(options.dryRun ?? false)) {
                changed.push({
                    path: plan.path,
                    existing: plan.existing,
                    installedSha256: sha256(plan.installed),
                });
            }
        }
        for (const plan of skillPlans) {
            if (plan.existing?.equals(plan.installed))
                continue;
            await atomicManagedWrite(options.paths, plan.path, plan.installed, {
                preserveMode: plan.existing !== null,
                mode: 0o600,
                dryRun: options.dryRun ?? false,
                expectedSha256: plan.existingSha256,
            });
            if (!(options.dryRun ?? false)) {
                changed.push({
                    path: plan.path,
                    existing: plan.existing,
                    installedSha256: sha256(plan.installed),
                });
            }
        }
        await writeInstallState(options.paths, state, options.dryRun ?? false, previousSnapshot?.sha256 ?? null);
    }
    catch (error) {
        for (const target of changed.reverse()) {
            const current = await readManaged(options.paths, target.path).catch(() => null);
            if (current === null || sha256(current) !== target.installedSha256)
                continue;
            if (target.existing === null)
                await removeManagedFile(options.paths, target.path, false, target.installedSha256).catch(() => undefined);
            else
                await atomicManagedWrite(options.paths, target.path, target.existing, {
                    preserveMode: true,
                    expectedSha256: target.installedSha256,
                }).catch(() => undefined);
        }
        throw error;
    }
    return state;
}
/** Read-only proof that every managed local entry is still exact and usable. */
export async function validateInstalledClientConfigurations(options) {
    validateInstallStatePaths(options.paths, options.state);
    for (const record of options.state.clients) {
        const current = await readManaged(options.paths, record.configPath);
        if (current === null)
            throw new Error(`Installed client configuration is missing: ${basename(record.configPath)}`);
        if (sha256(current) !== record.installedSha256) {
            const expected = record.client === "codex"
                ? codexClientEntry(record.packageSource, record.credentialMode)
                : jsonClientEntry(record.packageSource, record.credentialMode);
            // Structural removal validates the exact managed entry while allowing
            // unrelated user-owned configuration changes to remain present.
            removeEntry(record.client, current, expected);
        }
        if (record.backupPath !== null) {
            const backup = await readManaged(options.paths, record.backupPath);
            if (backup === null ||
                !basename(record.backupPath).endsWith(`${sha256(backup)}.bak`)) {
                throw new Error("The byte-exact client backup is missing or changed.");
            }
        }
    }
    for (const record of options.state.skills) {
        const skill = await readManaged(options.paths, record.path);
        if (skill === null || sha256(skill) !== record.installedSha256) {
            throw new Error(`The managed TrendsFast skill is missing or changed for ${record.client}.`);
        }
    }
}
function removeEntry(client, bytes, expected) {
    if (client === "codex") {
        const text = bytes.toString("utf8");
        const root = parseStrictToml(text);
        if (!isPlainObject(root.mcp_servers) || !(ENTRY_ID in root.mcp_servers))
            throw new Error("TrendsFast entry is missing or ambiguous.");
        if (!equal(root.mcp_servers[ENTRY_ID], expected))
            throw new Error("TrendsFast client entry was modified; refusing ambiguous uninstall.");
        const mode = "env_vars" in expected ? "environment" : "file";
        const args = expected.args;
        const source = Array.isArray(args) && typeof args[1] === "string" ? args[1] : null;
        if (source === null)
            throw new Error("Invalid managed Codex entry state.");
        const block = renderCodexBlock(source, mode);
        const first = text.indexOf(block);
        if (first < 0 || text.indexOf(block, first + 1) >= 0) {
            throw new Error("The managed Codex block was modified; refusing ambiguous uninstall.");
        }
        let start = first;
        if (start > 0 && text[start - 1] === "\n")
            start -= 1;
        return Buffer.from(text.slice(0, start) + text.slice(first + block.length));
    }
    const root = parseStrictJson(bytes.toString("utf8"));
    if (!isPlainObject(root.mcpServers) || !(ENTRY_ID in root.mcpServers))
        throw new Error("TrendsFast entry is missing or ambiguous.");
    if (!equal(root.mcpServers[ENTRY_ID], expected))
        throw new Error("TrendsFast client entry was modified; refusing ambiguous uninstall.");
    delete root.mcpServers[ENTRY_ID];
    if (Object.keys(root.mcpServers).length === 0)
        delete root.mcpServers;
    return Buffer.from(JSON.stringify(root, null, 2) + "\n");
}
export async function uninstallClientConfigurations(options) {
    validateInstallStatePaths(options.paths, options.state);
    const stateSnapshot = await readInstallStateSnapshot(options.paths);
    if (stateSnapshot === null ||
        JSON.stringify(stateSnapshot.state) !== JSON.stringify(options.state)) {
        throw new Error("Install state changed before uninstall.");
    }
    await validateInstallPermissions(options.paths, stateSnapshot.state);
    const plans = [];
    for (const record of options.state.clients) {
        const current = await readManaged(options.paths, record.configPath);
        if (!current)
            throw new Error(`Installed client configuration is missing: ${basename(record.configPath)}`);
        if (sha256(current) === record.installedSha256) {
            if (record.originalExisted) {
                if (!record.backupPath)
                    throw new Error("Install state is missing its backup reference.");
                const backup = await readManaged(options.paths, record.backupPath);
                if (!backup)
                    throw new Error("The byte-exact client backup is missing.");
                if (!basename(record.backupPath).endsWith(`${sha256(backup)}.bak`)) {
                    throw new Error("The byte-exact client backup changed.");
                }
                plans.push({ path: record.configPath, current, replacement: backup });
            }
            else {
                plans.push({ path: record.configPath, current, replacement: null });
            }
        }
        else {
            const expected = record.client === "codex"
                ? codexClientEntry(record.packageSource, record.credentialMode)
                : jsonClientEntry(record.packageSource, record.credentialMode);
            const cleaned = removeEntry(record.client, current, expected);
            plans.push({ path: record.configPath, current, replacement: cleaned });
        }
    }
    for (const record of options.state.skills) {
        const current = await readManaged(options.paths, record.path);
        if (current === null)
            continue;
        if (sha256(current) !== record.installedSha256) {
            throw new Error(`The managed TrendsFast skill was modified for ${record.client}; refusing ambiguous uninstall.`);
        }
        plans.push({ path: record.path, current, replacement: null });
    }
    for (const backupPath of new Set(options.state.clients
        .map((record) => record.backupPath)
        .filter((path) => path !== null))) {
        const backup = await readManaged(options.paths, backupPath);
        if (backup !== null)
            plans.push({ path: backupPath, current: backup, replacement: null });
    }
    const changed = [];
    try {
        await options.beforeCommit?.();
        for (const plan of plans) {
            if (plan.replacement === null)
                await removeManagedFile(options.paths, plan.path, options.dryRun ?? false, sha256(plan.current));
            else
                await atomicManagedWrite(options.paths, plan.path, plan.replacement, {
                    preserveMode: true,
                    dryRun: options.dryRun ?? false,
                    expectedSha256: sha256(plan.current),
                });
            if (!(options.dryRun ?? false))
                changed.push(plan);
        }
        await removeInstallState(options.paths, options.dryRun ?? false, stateSnapshot.sha256);
    }
    catch (error) {
        for (const plan of changed.reverse()) {
            const current = await readManaged(options.paths, plan.path).catch(() => null);
            if (plan.replacement !== null &&
                (current === null || sha256(current) !== sha256(plan.replacement)))
                continue;
            if (plan.replacement === null && current !== null)
                continue;
            await atomicManagedWrite(options.paths, plan.path, plan.current, {
                mode: 0o600,
                preserveMode: current !== null,
                expectedSha256: plan.replacement === null ? null : sha256(plan.replacement),
            }).catch(() => undefined);
        }
        throw error;
    }
}
