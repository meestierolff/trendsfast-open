import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
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
export async function assertSafePathFromRoot(trustedRoot, target) {
    const pathApi = posix.isAbsolute(trustedRoot) ? posix : win32;
    const relative = pathApi.relative(trustedRoot, target);
    if (relative === ".." ||
        relative.startsWith(`..${pathApi.sep}`) ||
        pathApi.isAbsolute(relative)) {
        throw new Error(`Path escapes its trusted configuration root: ${target}`);
    }
    const root = await statOrNull(trustedRoot);
    if (root === null || root.isSymbolicLink() || !root.isDirectory()) {
        throw new Error(`Trusted configuration root is missing, symbolic, or not a directory: ${trustedRoot}`);
    }
    let current = trustedRoot;
    for (const component of relative.split(pathApi.sep).filter(Boolean)) {
        current = pathApi.join(current, component);
        const stat = await statOrNull(current);
        if (stat === null)
            break;
        if (stat.isSymbolicLink()) {
            throw new Error(`Refusing symbolic-link path component: ${current}`);
        }
        if (current !== target && !stat.isDirectory()) {
            throw new Error(`Refusing non-directory path component: ${current}`);
        }
    }
}
async function readRegularFileSnapshot(path, trustedRoot) {
    if (trustedRoot !== undefined)
        await assertSafePathFromRoot(trustedRoot, path);
    const before = await statOrNull(path);
    if (!before)
        return null;
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
        throw new Error(`Refusing non-regular or symbolic-link file: ${path}`);
    }
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(path, constants.O_RDONLY | noFollow);
    try {
        const opened = await handle.stat();
        if (!opened.isFile() ||
            opened.nlink !== 1 ||
            opened.dev !== before.dev ||
            opened.ino !== before.ino) {
            throw new Error(`File changed while opening secure read: ${path}`);
        }
        if (opened.size > 1_048_576)
            throw new Error(`Refusing oversized configuration file: ${path}`);
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (after.dev !== opened.dev ||
            after.ino !== opened.ino ||
            after.size !== opened.size ||
            after.mode !== opened.mode ||
            after.mtimeMs !== opened.mtimeMs ||
            after.ctimeMs !== opened.ctimeMs) {
            throw new Error(`File changed during secure read: ${path}`);
        }
        if (trustedRoot !== undefined)
            await assertSafePathFromRoot(trustedRoot, path);
        return { bytes, stat: after };
    }
    finally {
        await handle.close();
    }
}
export async function assertRegularFile(path, trustedRoot) {
    if (trustedRoot !== undefined)
        await assertSafePathFromRoot(trustedRoot, path);
    const stat = await statOrNull(path);
    if (!stat)
        throw new Error(`Expected a regular file: ${path}`);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Refusing non-regular or symbolic-link file: ${path}`);
    }
}
export async function readRegularFile(path, trustedRoot) {
    return (await readRegularFileSnapshot(path, trustedRoot))?.bytes ?? null;
}
export async function readRegularFileWithMetadata(path, trustedRoot) {
    const snapshot = await readRegularFileSnapshot(path, trustedRoot);
    return snapshot === null
        ? null
        : { bytes: snapshot.bytes, mode: Number(snapshot.stat.mode) & 0o777 };
}
export async function ensurePrivateDirectory(path, dryRun = false, trustedRoot) {
    if (trustedRoot !== undefined)
        await assertSafePathFromRoot(trustedRoot, path);
    const existing = await statOrNull(path);
    if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) {
            throw new Error(`Refusing non-directory or symbolic-link path: ${path}`);
        }
        if (!dryRun)
            await chmod(path, 0o700);
        if (trustedRoot !== undefined)
            await assertSafePathFromRoot(trustedRoot, path);
        return;
    }
    if (dryRun)
        return;
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
    if (trustedRoot !== undefined)
        await assertSafePathFromRoot(trustedRoot, path);
}
async function ensureContainingDirectory(path, dryRun, trustedRoot) {
    if (trustedRoot !== undefined)
        await assertSafePathFromRoot(trustedRoot, path);
    const existing = await statOrNull(path);
    if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) {
            throw new Error(`Refusing non-directory or symbolic-link path: ${path}`);
        }
        if (trustedRoot !== undefined)
            await assertSafePathFromRoot(trustedRoot, path);
        return;
    }
    if (!dryRun) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        if (trustedRoot !== undefined)
            await assertSafePathFromRoot(trustedRoot, path);
    }
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
    await ensureContainingDirectory(parent, options.dryRun ?? false, options.trustedRoot);
    const snapshot = await readRegularFileSnapshot(path, options.trustedRoot);
    if (options.expectedSha256 !== undefined) {
        const actualSha256 = snapshot === null ? null : sha256(snapshot.bytes);
        if (actualSha256 !== options.expectedSha256) {
            throw new Error(`File changed after the write was planned: ${path}`);
        }
    }
    if (options.dryRun)
        return;
    const mode = options.preserveMode && snapshot
        ? Number(snapshot.stat.mode) & 0o777
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
        if (options.trustedRoot !== undefined)
            await assertSafePathFromRoot(options.trustedRoot, temporary);
        const current = await statOrNull(path);
        if (Boolean(snapshot) !== Boolean(current) ||
            (snapshot &&
                current &&
                (snapshot.stat.dev !== current.dev ||
                    snapshot.stat.ino !== current.ino ||
                    snapshot.stat.size !== current.size ||
                    snapshot.stat.mtimeMs !== current.mtimeMs ||
                    snapshot.stat.ctimeMs !== current.ctimeMs))) {
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
export async function writeByteExactBackup(path, bytes, dryRun = false, trustedRoot) {
    const existing = await readRegularFile(path, trustedRoot);
    if (existing) {
        if (!existing.equals(Buffer.from(bytes))) {
            throw new Error(`Refusing to overwrite a different backup: ${path}`);
        }
        return;
    }
    try {
        await atomicWriteFile(path, bytes, {
            mode: 0o600,
            dryRun,
            expectedSha256: null,
            ...(trustedRoot === undefined ? {} : { trustedRoot }),
        });
    }
    catch (error) {
        const winner = await readRegularFile(path, trustedRoot).catch(() => null);
        if (winner !== null && winner.equals(Buffer.from(bytes)))
            return;
        throw error;
    }
}
export async function removeRegularFile(path, dryRun = false, expectedSha256, trustedRoot) {
    const snapshot = await readRegularFileSnapshot(path, trustedRoot);
    if (!snapshot)
        return;
    if (expectedSha256 !== undefined &&
        sha256(snapshot.bytes) !== expectedSha256) {
        throw new Error(`File changed after removal was planned: ${path}`);
    }
    if (!dryRun) {
        if (trustedRoot !== undefined)
            await assertSafePathFromRoot(trustedRoot, path);
        const current = await statOrNull(path);
        if (current === null ||
            current.dev !== snapshot.stat.dev ||
            current.ino !== snapshot.stat.ino ||
            current.size !== snapshot.stat.size ||
            current.mtimeMs !== snapshot.stat.mtimeMs ||
            current.ctimeMs !== snapshot.stat.ctimeMs) {
            throw new Error(`File changed while preparing removal: ${path}`);
        }
        await rm(path);
        await syncDirectory(dirname(path));
    }
}
export async function removeEmptyDirectory(path, dryRun = false, trustedRoot) {
    if (trustedRoot !== undefined)
        await assertSafePathFromRoot(trustedRoot, path);
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
