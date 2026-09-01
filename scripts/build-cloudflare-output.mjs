import { spawnSync } from "node:child_process";

const isWorkersBuild = process.env.WORKERS_CI === "1";
const isNestedBuild = process.env.BANNERLORDCOOP_OPENNEXT_POSTBUILD === "1";

if (!isWorkersBuild || isNestedBuild) {
  process.exit(0);
}

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error("npm_execpath is required to run the OpenNext postbuild.");
}

const result = spawnSync(
  process.execPath,
  [npmCli, "exec", "--", "opennextjs-cloudflare", "build", "--skipNextBuild"],
  {
    env: {
      ...process.env,
      BANNERLORDCOOP_OPENNEXT_POSTBUILD: "1",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

if (result.signal) {
  console.error(`OpenNext build terminated by signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);
