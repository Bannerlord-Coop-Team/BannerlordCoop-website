import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { FUNCTIONS, sources, sourceDigest, checkAuthentication, matchesDeployment, ensureDeployment, boundedJson } from "./deploy-hosting-functions.mjs";

async function fixture(t, extra = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hosting-edge-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "my-servers/index.ts": 'import "../_shared/owner.ts";',
    "control-plane-admin/index.ts": 'export { handler } from "../_shared/admin.ts";',
    "public-servers/index.ts": 'import "../_shared/public.ts";',
    "_shared/owner.ts": 'import type { Contract } from "./contract.ts";',
    "_shared/admin.ts": "export const handler = true;",
    "_shared/public.ts": 'import "./contract.ts";',
    "_shared/contract.ts": "export type Contract = string;",
    ...extra,
  };
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, "supabase/functions", name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

test("shared contracts change every importing source digest, including type-only dependencies", async (t) => {
  const root = await fixture(t);
  const before = new Map(await Promise.all(Object.keys(FUNCTIONS).map(async (name) => [name, sourceDigest(await sources(root, name))])));
  await writeFile(path.join(root, "supabase/functions/_shared/contract.ts"), "export type Contract = number;");
  for (const name of Object.keys(FUNCTIONS)) {
    assert.equal(before.get(name) === sourceDigest(await sources(root, name)), name === "control-plane-admin");
  }
});

test("rejects imports outside the bundle and unsupported dynamic or external imports", async (t) => {
  for (const source of ['import "../../outside.ts";', 'import("npm:unreviewed");', "import(name);", 'require(name);']) {
    const root = await fixture(t, { "my-servers/index.ts": source });
    await assert.rejects(sources(root, "my-servers"));
  }
  const root = await fixture(t);
  await assert.rejects(sources(root, "patreon-start"), /Unsupported hosting function/u);
  await writeFile(path.join(root, "supabase/functions/deno.json"), "{}");
  await assert.rejects(sources(root, "my-servers"), /runtime configuration/u);
});

test("rejects a dependency symlink that leaves the function directory", async (t) => {
  const root = await fixture(t);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "contract.ts"), "export const secret = false;");
  await writeFile(path.join(root, "supabase/functions/my-servers/index.ts"), 'import "../_shared/escape/contract.ts";');
  await symlink(outside, path.join(root, "supabase/functions/_shared/escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(sources(root, "my-servers"), /leaves its source directory/u);
});

test("reads UTF-8 source without corrupting configuration messages", async (t) => {
  const message = 'export const message = "“mod-config.json — gameplay settings”";';
  const root = await fixture(t, { "my-servers/index.ts": message });
  const files = await sources(root, "my-servers");
  assert.equal(files.get("my-servers/index.ts"), message + "\n");
  assert.notEqual(sourceDigest(files), sourceDigest(new Map([["my-servers/index.ts", Buffer.from(message).toString("latin1") + "\n"]])));
});

test("verification JSON refuses an oversized or malformed upstream body", async () => {
  assert.deepEqual(await boundedJson(Response.json({ ok: true })), { ok: true });
  await assert.rejects(boundedJson(new Response(" ".repeat(262_145))), /too large/u);
  await assert.rejects(boundedJson(new Response("{")), SyntaxError);
});

const expected = new Map([["my-servers/index.ts", "export const handler = true;\n"]]);
const currentMetadata = { slug: "my-servers", version: 58, status: "ACTIVE", verify_jwt: true };
const current = { files: expected, metadata: currentMetadata };
const outdated = { files: new Map([["my-servers/index.ts", "export const handler = false;\n"]]), metadata: currentMetadata };

test("source equality rejects missing or extra dependencies and authentication drift", () => {
  assert.equal(sourceDigest(expected), sourceDigest(new Map([...expected].reverse())));
  assert.equal(matchesDeployment(expected, expected, currentMetadata, "my-servers"), true);
  assert.equal(matchesDeployment(expected, new Map(), currentMetadata, "my-servers"), false);
  assert.equal(matchesDeployment(expected, new Map([...expected, ["_shared/extra.ts", ""]]), currentMetadata, "my-servers"), false);
  for (const patch of [{ verify_jwt: false }, { status: "FAILED" }, { version: 0 }, { slug: "other" }]) {
    assert.equal(matchesDeployment(expected, expected, { ...currentMetadata, ...patch }, "my-servers"), false);
  }
});

test("preserves the separate public and authenticated JWT policies", () => {
  const config = Object.entries(FUNCTIONS).map(([name, jwt]) => "[functions." + name + "]\nverify_jwt = " + jwt + "\n").join("\n");
  checkAuthentication(config);
  checkAuthentication((config + "# Operator comment\n").replaceAll("\n", "\r\n"));
  assert.throws(() => checkAuthentication(config.replace("verify_jwt = true", "verify_jwt = false")), /JWT policy/u);
  assert.throws(() => checkAuthentication(config + "[functions.my-servers]\nverify_jwt = true\n"), /JWT policy/u);
  assert.throws(() => checkAuthentication(config.replace("verify_jwt = true", 'verify_jwt = true\nentrypoint = "other.ts"')), /JWT policy/u);
});

test("an already-current deployment never repeats the mutation", async () => {
  let writes = 0;
  const result = await ensureDeployment({ name: "my-servers", expected, mode: "deploy", read: async () => current, deploy: async () => { writes++; } });
  assert.equal(result.outcome, "already-current");
  assert.equal(writes, 0);
});

test("verification refuses outdated sources without deploying", async () => {
  await assert.rejects(ensureDeployment({ name: "my-servers", expected, mode: "verify", read: async () => outdated,
    deploy: async () => assert.fail("Verification must not mutate") }), /outdated/u);
});

test("deploy success is accepted only after source and authentication are reread", async () => {
  let reads = 0;
  const result = await ensureDeployment({ name: "my-servers", expected, mode: "deploy", read: async () => ++reads === 1 ? outdated : current,
    deploy: async () => {} });
  assert.equal(result.outcome, "deployed");
  assert.equal(reads, 2);
  await assert.rejects(ensureDeployment({ name: "my-servers", expected, mode: "deploy", read: async () => outdated,
    deploy: async () => {} }), /could not be verified/u);
});

test("a lost deployment response reconciles once and never launches a competing retry", async () => {
  let reads = 0, writes = 0;
  const result = await ensureDeployment({ name: "my-servers", expected, mode: "deploy", read: async () => ++reads === 1 ? outdated : current,
    deploy: async () => { writes++; throw new Error("Lost response"); } });
  assert.equal(result.outcome, "reconciled");
  assert.equal(writes, 1);
  await assert.rejects(ensureDeployment({ name: "my-servers", expected, mode: "deploy", read: async () => outdated,
    deploy: async () => { throw new Error("Lost response"); } }), /reconcile/u);
});

test("repository graph captures the live bug's configuration module and JWT policies", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = await sources(root, "my-servers");
  assert.ok(files.get("_shared/managed-server-configuration.ts").includes("ManagedVoiceConfiguration"));
  assert.ok(files.get("_shared/managed-server-configuration.ts").includes("coopClansEnabled"));
  checkAuthentication(await readFile(path.join(root, "supabase/config.toml"), "utf8"));
});

test("the CLI fails the release when used off main or without the deployment credential", () => {
  const script = fileURLToPath(new URL("./deploy-hosting-functions.mjs", import.meta.url));
  const env = { ...process.env, GITHUB_REF: "refs/heads/feature" };
  delete env.SUPABASE_ACCESS_TOKEN;
  const branch = spawnSync(process.execPath, [script, "deploy"], { env, encoding: "utf8", windowsHide: true });
  assert.equal(branch.status, 1);
  assert.match(branch.stderr, /requires the main GitHub workflow/u);
  const credential = spawnSync(process.execPath, [script, "verify"], { env, encoding: "utf8", windowsHide: true });
  assert.equal(credential.status, 1);
  assert.match(credential.stderr, /deployment secret is missing/u);
});
