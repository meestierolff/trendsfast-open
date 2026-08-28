import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { lstat } from "node:fs/promises";
import { atomicWriteFile, ensurePrivateDirectory, readRegularFile, removeRegularFile, } from "./files.js";
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
    await ensurePrivateDirectory(options.paths.configDir, options.dryRun ?? false);
    await atomicWriteFile(options.paths.credentialFile, Buffer.from(`${apiKey}\n`), {
        mode: 0o600,
        dryRun: options.dryRun ?? false,
    });
}
export async function readCredential(options) {
    if (options.mode === "environment") {
        return validateApiKey((options.env ?? process.env)[API_KEY_ENV]);
    }
    const bytes = await readRegularFile(options.paths.credentialFile);
    if (!bytes)
        throw new Error("The protected TrendsFast credential file is missing.");
    if (process.platform !== "win32") {
        const mode = (await lstat(options.paths.credentialFile)).mode & 0o777;
        if ((mode & 0o077) !== 0)
            throw new Error("The TrendsFast credential file permissions are too broad.");
    }
    return validateApiKey(bytes.toString("utf8").replace(/\n$/u, ""));
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
export function serializeInstallState(state) {
    assertStateShape(state);
    const text = JSON.stringify(state, null, 2) + "\n";
    if (/tf_(?:live|test)_[A-Za-z0-9_-]+/u.test(text)) {
        throw new Error("Refusing to persist credential material in install state.");
    }
    return Buffer.from(text);
}
export async function readInstallState(paths) {
    const bytes = await readRegularFile(paths.stateFile);
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
    return value;
}
export async function validateInstallPermissions(paths, state) {
    if (state === null || process.platform === "win32")
        return;
    const directory = await lstat(paths.configDir);
    if (directory.isSymbolicLink() ||
        !directory.isDirectory() ||
        (directory.mode & 0o077) !== 0) {
        throw new Error("The TrendsFast config directory permissions are unsafe.");
    }
    const stateFile = await lstat(paths.stateFile);
    if (stateFile.isSymbolicLink() ||
        !stateFile.isFile() ||
        (stateFile.mode & 0o077) !== 0) {
        throw new Error("The TrendsFast install-state permissions are unsafe.");
    }
}
export async function writeInstallState(paths, state, dryRun = false) {
    await atomicWriteFile(paths.stateFile, serializeInstallState(state), {
        mode: 0o600,
        dryRun,
    });
}
export async function removeInstallState(paths, dryRun = false) {
    await removeRegularFile(paths.stateFile, dryRun);
}
