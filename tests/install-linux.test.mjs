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

test("Linux gateway failures retain HTTP status and error codes", () => {
    const installer = readFileSync(new URL("../installer/install-linux.sh", import.meta.url), "utf8");
    assert.match(installer, /gateway_failure_detail/);
    assert.match(installer, /HTTP %s; error=%s/);
    assert.match(installer, /The nightly authorization service returned an error/);
    assert.match(installer, /Could not read the release manifest/);
});

test("Linux diagnostics redact hostile error values and retain safe codes", {
    skip: process.platform === "win32" && !process.env.COOP_TEST_BASH && "Set COOP_TEST_BASH to native Cygwin bash on Windows.",
}, () => {
    const installer = readFileSync(new URL("../installer/install-linux.sh", import.meta.url), "utf8");
    const functions = ["json_get", "gateway_failure_detail"].map((name) => {
        const source = installer.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
        assert.ok(source, `${name} must be available in the real installer`);
        return source[0];
    }).join("\n");
    const cases = [
        ["https://example.invalid/private?token=secret", "gateway error unavailable"],
        ["AbC9_-".repeat(8), "gateway error unavailable"],
        ["internal_error\nprivate_value", "gateway error unavailable"],
        ["internal_error\n", "gateway error unavailable"],
        ["x".repeat(65), "gateway error unavailable"],
        ["gateway_v2_error_1", "error=gateway_v2_error_1"],
    ];
    for (const [error, expected] of cases) {
        const script = `${functions}\nresponse=$(mktemp)\ntrap 'rm -f "$response"' EXIT
cat > "$response" <<'COOP_DIAGNOSTIC_JSON'
${JSON.stringify({ error })}
COOP_DIAGNOSTIC_JSON
gateway_failure_detail 502 "$response"
`;
        const result = spawnSync(process.env.COOP_TEST_BASH || "bash", ["-lc", "exec bash -s"], {
            input: script, encoding: "utf8", timeout: 30_000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, `HTTP 502; ${expected}`, JSON.stringify(error));
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
