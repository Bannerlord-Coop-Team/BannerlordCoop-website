import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const installers = ["install.cmd", "install.ps1", "install.sh", "install-linux.sh"];

for (const name of installers) {
    const from = `installer/${name}`;
    const to = `nightly-gateway/public/${name}`;
    if (name.endsWith(".sh")) {
        writeFileSync(to, readFileSync(from, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
        continue;
    }
    copyFileSync(from, to);
}
