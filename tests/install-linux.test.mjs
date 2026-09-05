import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("published Linux installers match the canonical scripts", () => {
    for (const name of ["install.sh", "install-linux.sh"]) {
        const source = readFileSync(new URL(`../installer/${name}`, import.meta.url), "utf8");
        const published = readFileSync(new URL(`../nightly-gateway/public/${name}`, import.meta.url), "utf8");
        assert.equal(published, source.replace(/\r\n?/g, "\n"));
        assert.equal(published.includes("\r"), false);
    }
});

test("Linux installer handles Windows release contracts and failure recovery", {
    skip: process.platform !== "linux" && "Run npm run test:installer-linux on Linux or WSL.",
}, () => {
    const result = spawnSync("python3", ["tests/test_install_linux.py"], {
        cwd: root, encoding: "utf8", timeout: 120_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
