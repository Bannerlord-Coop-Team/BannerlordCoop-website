// Runs every unit test file in the repo under `tsx --test`, so a new `*.test.*` file runs without being listed.
// Component tests (vitest) and suites that need live services are excluded here and run by their own scripts.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_FILE = /\.test\.(?:ts|tsx|mjs)$/u;
const COMPONENT_TEST_FILE = /\.component\.test\.tsx$/u;
const SKIPPED_DIRECTORIES = new Set([".git", ".next", ".open-next", ".wrangler", "node_modules", "coverage", "dist"]);

/** Suites that need a live Postgres or GoTrue; they run via `test:membership:postgres` and `test:membership:locking`. */
export const LIVE_SERVICE_TESTS = Object.freeze([
    "tests/membership-gotrue.test.ts",
    "tests/membership-postgres.test.ts",
    "tests/membership-role-postgres.test.ts",
]);

/** Lists the repo-relative unit test files under `root`, sorted, excluding component and live-service suites. */
export function selectUnitTestFiles(root) {
    const excluded = new Set(LIVE_SERVICE_TESTS);
    return walk(root)
        .map((path) => relative(root, path).split(sep).join("/"))
        .filter((path) => TEST_FILE.test(path) && !COMPONENT_TEST_FILE.test(path) && !excluded.has(path))
        .sort();
}

/** Returns every file below `directory`, skipping build output, dependencies and VCS metadata. */
function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : walk(path);
        return entry.isFile() ? [path] : [];
    });
}

/** Runs the selected files through the tsx CLI's test runner and exits with its status. */
function main() {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = selectUnitTestFiles(root);
    if (files.length === 0) {
        console.error("No unit test files found.");
        process.exit(1);
    }
    const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
    const result = spawnSync(process.execPath, [tsxCli, "--test", ...process.argv.slice(2), ...files], { cwd: root, stdio: "inherit" });
    process.exit(result.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
