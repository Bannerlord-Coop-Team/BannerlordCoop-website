import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"].includes(key.toUpperCase())));
env.NEXT_TELEMETRY_DISABLED = "1";
env.NODE_OPTIONS = `--require="${resolve("tests/onboarding-offline-build.cjs").replaceAll("\\", "/")}"`;
const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const postbuild = spawnSync(process.execPath, ["scripts/build-cloudflare-output.mjs"], { env, stdio: "inherit" });
process.exit(postbuild.status ?? 1);
