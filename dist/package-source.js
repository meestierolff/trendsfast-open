import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PACKAGE_SOURCE, PACKAGE_NAME, PACKAGE_VERSION, } from "./constants.js";
import { TrendsFastError } from "./errors.js";
const EXACT_GITHUB_SOURCE = /^github:meestierolff\/trendsfast-open#[0-9a-f]{40}$/;
const EXACT_NPM_SOURCE = new RegExp(`^${PACKAGE_NAME.replace("-", "\\-")}@${PACKAGE_VERSION.replaceAll(".", "\\.")}$`);
const GITHUB_RESOLVED = /(?:github\.com[\/:]meestierolff\/trendsfast-open(?:\.git)?[#\/])([0-9a-f]{40})(?:$|\?)/i;
export function validatePackageSource(value) {
    const source = value.trim();
    if (EXACT_GITHUB_SOURCE.test(source) || EXACT_NPM_SOURCE.test(source))
        return source;
    throw new TrendsFastError("INVALID_PACKAGE_SOURCE", "The package source must be the exact release version or immutable TrendsFast GitHub SHA.");
}
function githubSourceFromResolved(value) {
    if (typeof value !== "string")
        return null;
    if (EXACT_GITHUB_SOURCE.test(value))
        return value;
    const match = GITHUB_RESOLVED.exec(value);
    return match?.[1] === undefined
        ? null
        : `github:meestierolff/trendsfast-open#${match[1].toLowerCase()}`;
}
function sourceFromAncestorLock(start) {
    let directory = start;
    for (let depth = 0; depth < 12; depth += 1) {
        const candidate = resolve(directory, "node_modules/.package-lock.json");
        if (existsSync(candidate)) {
            try {
                const parsed = JSON.parse(readFileSync(candidate, "utf8"));
                for (const [path, metadata] of Object.entries(parsed.packages ?? {})) {
                    if (path.endsWith(`/node_modules/${PACKAGE_NAME}`) ||
                        path === `node_modules/${PACKAGE_NAME}`) {
                        const source = githubSourceFromResolved(metadata.resolved);
                        if (source !== null)
                            return source;
                    }
                }
            }
            catch {
                // An npm cache lock is advisory. Ignore malformed unrelated state.
            }
        }
        const parent = dirname(directory);
        if (parent === directory)
            break;
        directory = parent;
    }
    return null;
}
/**
 * Resolves the public source that should be written into generated client
 * configuration. An explicit public source wins; npm's execution metadata is
 * then inspected so an immutable GitHub npx run records its exact commit.
 */
export function resolvePackageSource(environment = process.env) {
    if (environment.TRENDSFAST_PACKAGE_SOURCE !== undefined) {
        return validatePackageSource(environment.TRENDSFAST_PACKAGE_SOURCE);
    }
    for (const value of [
        environment.npm_config_package,
        environment.npm_package_resolved,
        environment.npm_package_from,
    ]) {
        const source = githubSourceFromResolved(value);
        if (source !== null)
            return source;
    }
    const inferred = sourceFromAncestorLock(dirname(fileURLToPath(import.meta.url)));
    return inferred ?? DEFAULT_PACKAGE_SOURCE;
}
