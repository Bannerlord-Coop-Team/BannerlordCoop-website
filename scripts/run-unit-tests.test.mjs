// Checks which files the unit-test runner selects, against a throwaway directory tree.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { LIVE_SERVICE_TESTS, selectUnitTestFiles } from "./run-unit-tests.mjs";

/** Creates each repo-relative file (and its folders) under a new temp directory and returns that directory. */
function tree(files) {
    const root = mkdtempSync(join(tmpdir(), "unit-test-select-"));
    for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), "");
    }
    return root;
}

test("selects every .test.ts, .test.tsx and .test.mjs file, sorted", () => {
    const root = tree(["src/b.test.ts", "src/a/x.test.tsx", "tools/sync.test.mjs", "src/plain.ts", "src/b.spec.ts"]);
    try {
        assert.deepEqual(selectUnitTestFiles(root), ["src/a/x.test.tsx", "src/b.test.ts", "tools/sync.test.mjs"]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("leaves out vitest component tests, live-service suites, dependencies and build output", () => {
    const root = tree([
        "src/kept.test.ts",
        "src/Card.component.test.tsx",
        ...LIVE_SERVICE_TESTS,
        "node_modules/pkg/dep.test.ts",
        ".next/server/page.test.ts",
        ".open-next/out.test.ts",
    ]);
    try {
        assert.deepEqual(selectUnitTestFiles(root), ["src/kept.test.ts"]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
