import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
export function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
async function statOrNull(path) {
    try {
        return await lstat(path);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
}
export async function assertRegularFile(path) {
    const stat = await statOrNull(path);
    if (!stat)
        throw new Error(`Expected a regular file: ${path}`);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Refusing non-regular or symbolic-link file: ${path}`);
    }
}
export async function readRegularFile(path) {
    const before = await statOrNull(path);
    if (!before)
        return null;
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
        throw new Error(`Refusing non-regular or symbolic-link file: ${path}`);
    }
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(path, constants.O_RDONLY | noFollow);
    try {
        const after = await handle.stat();
        if (!after.isFile() ||
            after.nlink !== 1 ||
            after.dev !== before.dev ||
            after.ino !== before.ino) {
            throw new Error(`File changed while opening secure read: ${path}`);
        }
        if (after.size > 1_048_576)
            throw new Error(`Refusing oversized configuration file: ${path}`);
        return await handle.readFile();
    }
    finally {
        await handle.close();
    }
}
export async function ensurePrivateDirectory(path, dryRun = false) {
    const existing = await statOrNull(path);
    if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) {
            throw new Error(`Refusing non-directory or symbolic-link path: ${path}`);
        }
        if (!dryRun)
            await chmod(path, 0o700);
        return;
    }
    if (dryRun)
        return;
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
}
async function ensureContainingDirectory(path, dryRun) {
    const existing = await statOrNull(path);
    if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) {
            throw new Error(`Refusing non-directory or symbolic-link path: ${path}`);
        }
        return;
    }
    if (!dryRun)
        await mkdir(path, { recursive: true, mode: 0o700 });
}
async function syncDirectory(path) {
    if (process.platform === "win32")
        return;
    const handle = await open(path, constants.O_RDONLY);
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
export async function atomicWriteFile(path, bytes, options = {}) {
    const parent = dirname(path);
    await ensureContainingDirectory(parent, options.dryRun ?? false);
    const before = await statOrNull(path);
    if (before &&
        (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1)) {
        throw new Error(`Refusing non-regular or symbolic-link file: ${path}`);
    }
    if (options.dryRun)
        return;
    const mode = options.preserveMode && before
        ? before.mode & 0o777
        : (options.mode ?? 0o600);
    const temporary = join(parent, `.${randomBytes(12).toString("hex")}.tmp`);
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, mode);
    let preparationError;
    try {
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.chmod(mode);
    }
    catch (error) {
        preparationError = error;
    }
    finally {
        await handle.close();
    }
    if (preparationError !== undefined) {
        await rm(temporary, { force: true });
        throw preparationError;
    }
    try {
        const current = await statOrNull(path);
        if (Boolean(before) !== Boolean(current) ||
            (before &&
                current &&
                (before.dev !== current.dev ||
                    before.ino !== current.ino ||
                    before.size !== current.size ||
                    before.mtimeMs !== current.mtimeMs ||
                    before.ctimeMs !== current.ctimeMs))) {
            throw new Error(`File changed while preparing atomic write: ${path}`);
        }
        if (current &&
            (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1)) {
            throw new Error(`Refusing non-regular or symbolic-link file: ${path}`);
        }
        await rename(temporary, path);
        await syncDirectory(parent);
    }
    catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}
export async function writeByteExactBackup(path, bytes, dryRun = false) {
    const existing = await readRegularFile(path);
    if (existing) {
        if (!existing.equals(Buffer.from(bytes))) {
            throw new Error(`Refusing to overwrite a different backup: ${path}`);
        }
        return;
    }
    await atomicWriteFile(path, bytes, { mode: 0o600, dryRun });
}
export async function removeRegularFile(path, dryRun = false) {
    const existing = await statOrNull(path);
    if (!existing)
        return;
    if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1) {
        throw new Error(`Refusing non-regular or symbolic-link file: ${path}`);
    }
    if (!dryRun) {
        await rm(path);
        await syncDirectory(dirname(path));
    }
}
export async function removeEmptyDirectory(path, dryRun = false) {
    const existing = await statOrNull(path);
    if (existing === null)
        return;
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error(`Refusing non-directory or symbolic-link path: ${path}`);
    }
    if (dryRun)
        return;
    try {
        await rmdir(path);
        await syncDirectory(dirname(path));
    }
    catch (error) {
        const code = error.code;
        if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOENT") {
            throw error;
        }
    }
}
