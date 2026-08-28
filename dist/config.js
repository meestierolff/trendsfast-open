import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { lstat } from "node:fs/promises";
import { assertSafePathFromRoot, atomicWriteFile, ensurePrivateDirectory, readRegularFile, readRegularFileWithMetadata, removeRegularFile, sha256, } from "./files.js";
export const API_KEY_ENV = "TRENDSFAST_API_KEY";
export function resolveConfigPaths(options = {}) {
    const homeDir = options.homeDir ?? homedir();
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const paths = platform === "win32" ? win32 : posix;
    if (!paths.isAbsolute(homeDir) || paths.parse(homeDir).root === homeDir) {
        throw new Error("The user home directory must be an absolute non-root path.");
    }
    const base = platform === "win32"
        ? (env.APPDATA ?? paths.join(homeDir, "AppData", "Roaming"))
        : (env.XDG_CONFIG_HOME ?? paths.join(homeDir, ".config"));
    if (!paths.isAbsolute(base) || paths.parse(base).root === base) {
        throw new Error("The platform config root must be an absolute non-root path.");
    }
    const configDir = paths.join(base, platform === "win32" ? "TrendsFast" : "trendsfast");
    return {
        homeDir,
        configRoot: base,
        configDir,
        credentialFile: paths.join(configDir, "api-key"),
        stateFile: paths.join(configDir, "install-state.json"),
        backupsDir: paths.join(configDir, "backups"),
        claudeConfig: paths.join(homeDir, ".claude.json"),
        codexConfig: paths.join(homeDir, ".codex", "config.toml"),
        genericConfig: paths.join(configDir, "mcp.json"),
        genericSkill: paths.join(configDir, "skills", "trendsfast", "SKILL.md"),
        claudeSkill: paths.join(homeDir, ".claude", "skills", "trendsfast", "SKILL.md"),
        codexSkill: paths.join(homeDir, ".agents", "skills", "trendsfast", "SKILL.md"),
    };
}
export function trustedRootForPath(paths, target) {
    const pathApi = posix.isAbsolute(paths.homeDir) ? posix : win32;
    const within = (root) => {
        const relative = pathApi.relative(root, target);
        return (relative !== ".." &&
            !relative.startsWith(`..${pathApi.sep}`) &&
            !pathApi.isAbsolute(relative));
    };
    if (within(paths.homeDir))
        return paths.homeDir;
    if (within(paths.configRoot))
        return paths.configRoot;
    throw new Error("Configuration target escapes its trusted roots.");
}
function validateApiKey(value) {
    if (!value ||
        value.length < 16 ||
        value.length > 2048 ||
        /[\s\u0000-\u001f\u007f]/u.test(value)) {
        throw new Error("A valid TrendsFast API key is required.");
    }
    return value;
}
export async function writeCredential(options) {
    if (!options.consent)
        throw new Error("Explicit consent is required before storing credentials.");
    const apiKey = validateApiKey(options.apiKey);
    await ensurePrivateDirectory(options.paths.configDir, options.dryRun ?? false, trustedRootForPath(options.paths, options.paths.configDir));
    await atomicWriteFile(options.paths.credentialFile, Buffer.from(`${apiKey}\n`), {
        mode: 0o600,
        dryRun: options.dryRun ?? false,
        expectedSha256: null,
        trustedRoot: trustedRootForPath(options.paths, options.paths.credentialFile),
    });
}
export async function readCredential(options) {
    if (options.mode === "environment") {
        return validateApiKey((options.env ?? process.env)[API_KEY_ENV]);
    }
    const snapshot = await readRegularFileWithMetadata(options.paths.credentialFile, trustedRootForPath(options.paths, options.paths.credentialFile));
    if (!snapshot)
        throw new Error("The protected TrendsFast credential file is missing.");
    if (process.platform !== "win32") {
        if ((snapshot.mode & 0o077) !== 0)
            throw new Error("The TrendsFast credential file permissions are too broad.");
    }
    return validateApiKey(snapshot.bytes.toString("utf8").replace(/\n$/u, ""));
}
function assertStateShape(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid install state.");
    }
    const state = value;
    const exact = [
        "schemaVersion",
        "endpoint",
        "protocolVersion",
        "packageVersion",
        "clients",
        "skills",
    ];
    if (Object.keys(state).sort().join("\0") !== exact.sort().join("\0") ||
        state.schemaVersion !== 1) {
        throw new Error("Invalid install state schema.");
    }
    if (typeof state.endpoint !== "string" ||
        typeof state.protocolVersion !== "string" ||
        typeof state.packageVersion !== "string" ||
        !Array.isArray(state.clients) ||
        !Array.isArray(state.skills))
        throw new Error("Invalid install state fields.");
    for (const record of state.clients) {
        if (!record || typeof record !== "object" || Array.isArray(record))
            throw new Error("Invalid client state.");
        const item = record;
        const keys = [
            "client",
            "configPath",
            "backupPath",
            "originalExisted",
            "installedSha256",
            "packageSource",
            "credentialMode",
        ];
        if (Object.keys(item).sort().join("\0") !== keys.sort().join("\0"))
            throw new Error("Invalid client state schema.");
        if (!["claude", "codex", "generic"].includes(item.client) ||
            typeof item.configPath !== "string" ||
            !(item.backupPath === null || typeof item.backupPath === "string") ||
            typeof item.originalExisted !== "boolean" ||
            typeof item.installedSha256 !== "string" ||
            !/^[0-9a-f]{64}$/u.test(item.installedSha256) ||
            typeof item.packageSource !== "string" ||
            !["environment", "file"].includes(item.credentialMode)) {
            throw new Error("Invalid client state fields.");
        }
    }
    for (const record of state.skills) {
        if (!record || typeof record !== "object" || Array.isArray(record))
            throw new Error("Invalid skill state.");
        const item = record;
        const keys = ["client", "path", "installedSha256"];
        if (Object.keys(item).sort().join("\0") !== keys.sort().join("\0"))
            throw new Error("Invalid skill state schema.");
        if (!["claude", "codex", "generic"].includes(item.client) ||
            typeof item.path !== "string" ||
            typeof item.installedSha256 !== "string" ||
            !/^[0-9a-f]{64}$/u.test(item.installedSha256)) {
            throw new Error("Invalid skill state fields.");
        }
    }
}
function expectedClientPath(paths, client) {
    return client === "claude"
        ? paths.claudeConfig
        : client === "codex"
            ? paths.codexConfig
            : paths.genericConfig;
}
function expectedSkillPath(paths, client) {
    return client === "claude"
        ? paths.claudeSkill
        : client === "codex"
            ? paths.codexSkill
            : paths.genericSkill;
}
/** Bind every persisted mutation target to the exact paths this install owns. */
export function validateInstallStatePaths(paths, state) {
    const pathApi = posix.isAbsolute(paths.configDir) ? posix : win32;
    const clients = new Set();
    for (const record of state.clients) {
        if (clients.has(record.client))
            throw new Error("Install state contains a duplicate client target.");
        clients.add(record.client);
        if (record.configPath !== expectedClientPath(paths, record.client)) {
            throw new Error("Install state contains an unowned client path.");
        }
        if (!record.originalExisted) {
            if (record.backupPath !== null)
                throw new Error("Install state contains an unexpected backup path.");
            continue;
        }
        if (record.backupPath === null)
            throw new Error("Install state is missing its confined backup path.");
        const expectedPrefix = `${record.client}-${sha256(Buffer.from(record.configPath)).slice(0, 16)}-`;
        const backupName = pathApi.basename(record.backupPath);
        if (pathApi.dirname(record.backupPath) !== paths.backupsDir ||
            !backupName.startsWith(expectedPrefix) ||
            !/^[0-9a-f]{64}\.bak$/u.test(backupName.slice(expectedPrefix.length))) {
            throw new Error("Install state contains an unconfined backup path.");
        }
    }
    const skills = new Set();
    for (const record of state.skills) {
        if (skills.has(record.client))
            throw new Error("Install state contains a duplicate skill target.");
        skills.add(record.client);
        if (!clients.has(record.client) ||
            record.path !== expectedSkillPath(paths, record.client)) {
            throw new Error("Install state contains an unowned skill path.");
        }
    }
}
export function serializeInstallState(state) {
    assertStateShape(state);
    const text = JSON.stringify(state, null, 2) + "\n";
    if (/tf_(?:live|test)_[A-Za-z0-9_-]+/u.test(text)) {
        throw new Error("Refusing to persist credential material in install state.");
    }
    return Buffer.from(text);
}
export async function readInstallState(paths) {
    return (await readInstallStateSnapshot(paths))?.state ?? null;
}
export async function readInstallStateSnapshot(paths) {
    const bytes = await readRegularFile(paths.stateFile, trustedRootForPath(paths, paths.stateFile));
    if (!bytes)
        return null;
    let value;
    try {
        value = JSON.parse(bytes.toString("utf8"));
    }
    catch {
        throw new Error("Install state is not valid JSON.");
    }
    assertStateShape(value);
    validateInstallStatePaths(paths, value);
    return { state: value, sha256: sha256(bytes) };
}
export async function validateInstallPermissions(paths, state) {
    if (state === null || process.platform === "win32")
        return;
    await assertSafePathFromRoot(trustedRootForPath(paths, paths.configDir), paths.configDir);
    await assertSafePathFromRoot(trustedRootForPath(paths, paths.stateFile), paths.stateFile);
    const directory = await lstat(paths.configDir);
    if (directory.isSymbolicLink() ||
        !directory.isDirectory() ||
        (directory.mode & 0o077) !== 0) {
        throw new Error("The TrendsFast config directory permissions are unsafe.");
    }
    const currentState = await readRegularFileWithMetadata(paths.stateFile, trustedRootForPath(paths, paths.stateFile));
    if (currentState === null || (currentState.mode & 0o077) !== 0) {
        throw new Error("The TrendsFast install-state permissions are unsafe.");
    }
    let parsed;
    try {
        parsed = JSON.parse(currentState.bytes.toString("utf8"));
    }
    catch {
        throw new Error("The TrendsFast install-state changed during validation.");
    }
    if (JSON.stringify(parsed) !== JSON.stringify(state)) {
        throw new Error("The TrendsFast install-state changed during validation.");
    }
}
export async function writeInstallState(paths, state, dryRun = false, expectedSha256) {
    await atomicWriteFile(paths.stateFile, serializeInstallState(state), {
        mode: 0o600,
        dryRun,
        ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
        trustedRoot: trustedRootForPath(paths, paths.stateFile),
    });
}
export async function removeInstallState(paths, dryRun = false, expectedSha256) {
    await removeRegularFile(paths.stateFile, dryRun, expectedSha256, trustedRootForPath(paths, paths.stateFile));
}
