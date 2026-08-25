import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("gateway installer sync writes Linux scripts with LF", () => {
    const root = mkdtempSync(join(tmpdir(), "coop-sync-"));
    mkdirSync(join(root, "installer"));
    mkdirSync(join(root, "nightly-gateway", "public"), { recursive: true });
    writeFileSync(join(root, "installer", "install.cmd"), "windows\r\n");
    writeFileSync(join(root, "installer", "install.ps1"), "windows\r\n");
    writeFileSync(join(root, "installer", "install.sh"), "#!/usr/bin/env bash\r\nset -eu\r\n");
    writeFileSync(join(root, "installer", "install-linux.sh"), "#!/usr/bin/env bash\r\n# Official\r\n");

    const script = fileURLToPath(new URL("./sync-installer.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);

    const launcher = readFileSync(join(root, "nightly-gateway", "public", "install.sh"));
    const installer = readFileSync(join(root, "nightly-gateway", "public", "install-linux.sh"));
    assert.equal(launcher.includes(13), false);
    assert.equal(installer.includes(13), false);
    assert.equal(launcher.toString("utf8"), "#!/usr/bin/env bash\nset -eu\n");
    assert.equal(installer.toString("utf8"), "#!/usr/bin/env bash\n# Official\n");
    assert.equal(readFileSync(join(root, "nightly-gateway", "public", "install.cmd"), "utf8"), "windows\r\n");
});
