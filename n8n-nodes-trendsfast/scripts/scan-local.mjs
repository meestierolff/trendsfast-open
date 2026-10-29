// Runs the static-analysis half of `npx @n8n/scan-community-package` before publishing.
//
// The real scanner works on a published package: it first checks npm provenance, then fetches
// the GitHub source that provenance names, then lints that source and the published tarball.
// The first two steps need the package on npm. This script runs the last step locally with the
// scanner's own `analyzePackage` and rules: the source files `n8n-node lint` covers, and the
// tarball `npm pack` would publish. It is not a substitute for the real scan after publishing.
//
// The scanner is installed into .scan/ (gitignored) rather than as a dev dependency, because
// its TypeScript 6 would replace the `tsc` this package builds with.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCANNER_VERSION = '0.41.1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, '.scan');
const scannerPrefix = join(work, `scanner-${SCANNER_VERSION}`);
const scannerPackage = join(scannerPrefix, 'node_modules/@n8n/scan-community-package');

function installedVersion() {
	const manifest = join(scannerPackage, 'package.json');
	return existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : undefined;
}

if (installedVersion() !== SCANNER_VERSION) {
	mkdirSync(scannerPrefix, { recursive: true });
	execFileSync(
		'npm',
		[
			'install',
			'--prefix',
			scannerPrefix,
			'--no-save',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			`@n8n/scan-community-package@${SCANNER_VERSION}`,
		],
		{ stdio: 'inherit' },
	);
}

const { analyzePackage, SOURCE_FILE_PATTERNS } = await import(
	pathToFileURL(join(scannerPackage, 'scanner/scanner.mjs')).href
);

const packDir = join(work, 'pack');
rmSync(packDir, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
const [packed] = JSON.parse(
	execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], {
		cwd: root,
		encoding: 'utf8',
	}),
);
execFileSync('tar', ['-xzf', join(packDir, packed.filename), '-C', packDir]);

let legs;
try {
	legs = [
		[
			'source (package.json, nodes/, credentials/)',
			await analyzePackage(root, SOURCE_FILE_PATTERNS),
		],
		[
			`tarball ${packed.filename} (${packed.entryCount} files)`,
			await analyzePackage(join(packDir, 'package'), ['**/*.js', 'package.json']),
		],
	];
} finally {
	// The unpacked tarball holds .d.ts files that `n8n-node lint` would otherwise pick up.
	rmSync(packDir, { recursive: true, force: true });
}

let passed = true;
for (const [label, result] of legs) {
	console.log(
		`${result.passed ? 'PASS' : 'FAIL'}  ${label}${result.message ? `: ${result.message}` : ''}`,
	);
	if (result.details) console.log(result.details);
	passed &&= result.passed;
}
console.log(
	'NOT RUN  provenance check and source fetch: they need the package published to npm from GitHub Actions.',
);
process.exitCode = passed ? 0 : 1;
