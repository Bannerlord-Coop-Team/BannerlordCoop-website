import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { FUNCTIONS, sources, sourceDigest, checkAuthentication, auditedFunctions, matchesDeployment, ensureDeployment, boundedJson } from "./deploy-hosting-functions.mjs";
import { auditEdgeFunctions } from "./audit-edge-functions.mjs";

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

test("the audit covers all website Edge functions and compares runtime dependencies", async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const policies = await auditedFunctions(root, await readFile(path.join(root, "supabase/config.toml"), "utf8"));
  for (const name of ["patreon-start", "patreon-complete", "create-github-issue-bug-report", "vps-renewal-alert", "nightly-gateway"]) {
    assert.equal(policies.get(name), false);
  }
  assert.equal(policies.has("admin-servers"), false);
  for (const name of policies.keys()) assert.ok((await sources(root, name, { audit: true })).has(name + "/index.ts"));
  const nightly = await sources(root, "nightly-gateway", { audit: true });
  assert.ok(nightly.has("_shared/nightly/gateway.ts"));
  assert.equal(nightly.has("_shared/nightly/context.ts"), false);
  const upload = await fixture(t, { "patreon-start/index.ts": 'import("npm:unreviewed");' });
  await assert.rejects(sources(upload, "patreon-start", { audit: true }), /External function imports/u);
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

const auditSlug = "patreon-callback";
const auditBase = "https://api.supabase.com/v1/projects/test-project/functions";
const readToken = "readonly-test-token";
const auditMetadata = {
  slug: auditSlug, status: "ACTIVE", verify_jwt: false, id: "test-function", version: 52, ezbr_sha256: "example-digest",
  entrypoint_path: "file:///source/supabase/functions/patreon-callback/index.ts",
};
const auditGraph = new Map([
  [auditSlug + "/index.ts", 'import "../_shared/runtime.ts";\n'],
  ["_shared/runtime.ts", "export const value = 1;\n"],
]);
const typeFile = "_shared/types.ts";
const allAuditFiles = new Map([...auditGraph, [typeFile, "export type Result = string;\n"]]);

// Supabase CLI v2.120.0's download fixtures use a metadata part and file paths
// in Content-Disposition or Supabase-Path. Keep those headers in the fixture.
function multipart(entrypoint, files) {
  const boundary = "audit-fixture-boundary";
  const parts = [
    "Content-Disposition: form-data; name=\"metadata\"\r\n\r\n" + JSON.stringify({ deno2_entrypoint_path: entrypoint }),
    ...files.map(([file, source]) => "Content-Disposition: form-data; name=\"file\"; filename=\"ignored.ts\"\r\n" +
      "Supabase-Path: " + file + "\r\n\r\n" + source),
  ];
  return new Response(parts.map((part) => "--" + boundary + "\r\n" + part + "\r\n").join("") + "--" + boundary + "--\r\n", {
    headers: { "content-type": 'multipart/form-data; boundary="' + boundary + '"' },
  });
}

function auditFixture({
  files = [...auditGraph].map(([file, source]) => ["source/" + file, source]),
  entrypoint = "source/patreon-callback/index.ts", metadata = auditMetadata,
  inventory = [auditMetadata], body, stop = "after", deadline,
} = {}) {
  const path = "/" + auditSlug;
  const calls = [["", "application/json", () => Response.json(inventory)]];
  if (stop !== "inventory") calls.push([path, "application/json", () => Response.json(metadata)]);
  if (stop === "body" || stop === "after") calls.push([path + "/body", "multipart/form-data", body ?? (() => multipart(entrypoint, files))]);
  if (stop === "after") calls.push([path, "application/json", () => Response.json(metadata)]);

  const lines = { log: [], warn: [], error: [] };
  return {
    lines,
    assertRequests: () => assert.equal(calls.length, 0),
    run: () => auditEdgeFunctions({
      projectRef: "test-project", token: readToken, policies: new Map([[auditSlug, false]]), deadline,
      expectedSources: async (name) => {
        assert.equal(name, auditSlug);
        return { runtime: auditGraph, all: allAuditFiles };
      },
      request: async (url, options) => {
        const expected = calls.shift();
        assert.ok(expected, "Unexpected Management API request");
        const [resource, accept, respond] = expected;
        assert.equal(url, auditBase + resource);
        assert.deepEqual({ ...options, signal: options.signal instanceof AbortSignal }, {
          method: "GET", headers: { authorization: "Bearer " + readToken, accept }, redirect: "error", signal: true,
        });
        return respond(options.signal);
      },
      log: Object.fromEntries(Object.entries(lines).map(([level, messages]) => [level, (line) => messages.push(line)])),
    }),
  };
}

test("audit accepts the selected main entry point and checks all source files supplied by Supabase", async () => {
  const good = auditFixture({ files: [...allAuditFiles].map(([file, bytes]) => ["source/" + file, bytes]) });
  await good.run();
  good.assertRequests();
  assert.deepEqual(good.lines.log, ["patreon-callback: v52, entry point, source bundle and JWT policy verified"]);

  const wrongEntrypoint = auditFixture({
    entrypoint: "source/patreon-callback/legacy.ts", stop: "body",
    files: [["source/patreon-callback/legacy.ts", 'import "./index.ts";'], ...[...auditGraph].map(([file, bytes]) => ["source/" + file, bytes])],
  });
  await assert.rejects(wrongEntrypoint.run(), /1 Edge function/u);
  wrongEntrypoint.assertRequests();
  assert.deepEqual(wrongEntrypoint.lines.error, ["patreon-callback: Deployed entry point differs from main"]);

  const inconsistentEntrypoint = auditFixture({
    metadata: { ...auditMetadata, entrypoint_path: "file:///source/patreon-callback/legacy.ts" }, stop: "body",
  });
  await assert.rejects(inconsistentEntrypoint.run(), /1 Edge function/u);
  inconsistentEntrypoint.assertRequests();
  assert.deepEqual(inconsistentEntrypoint.lines.error, wrongEntrypoint.lines.error);

  for (const files of [
    [["source/patreon-callback/unreachable.ts", "export {};"], ...[...auditGraph].map(([file, bytes]) => ["source/" + file, bytes])],
    [["source/" + typeFile, "export type Result = number;\n"], ...[...auditGraph].map(([file, bytes]) => ["source/" + file, bytes])],
    [["source/patreon-callback/index.ts", auditGraph.get("patreon-callback/index.ts")]],
  ]) {
    const drift = auditFixture({ files });
    await assert.rejects(drift.run(), /1 Edge function/u);
    drift.assertRequests();
    assert.deepEqual(drift.lines.error, ["patreon-callback: Deployed source bundle differs from main"]);
  }
});

test("audit reports each valid live-only slug, including names with underscores and capitals", async () => {
  const fixture = auditFixture({ inventory: [auditMetadata, { slug: "external-audit" }, { slug: "external_audit" }, { slug: "External_2" }] });
  await fixture.run();
  fixture.assertRequests();
  assert.deepEqual(fixture.lines.warn, ["Deployed outside website main: External_2, external-audit, external_audit"]);
  assert.equal(fixture.lines.error.length, 0);
});

test("audit fails on a missing tracked function or changed gateway policy", async () => {
  const missing = auditFixture({ inventory: [], stop: "inventory" });
  await assert.rejects(missing.run(), /Edge function/u);
  missing.assertRequests();
  assert.deepEqual(missing.lines.error, ["patreon-callback: Function is absent from the live inventory"]);

  const wrongJwt = auditFixture({ metadata: { ...auditMetadata, verify_jwt: true }, stop: "metadata" });
  await assert.rejects(wrongJwt.run(), /Edge function/u);
  wrongJwt.assertRequests();
  assert.deepEqual(wrongJwt.lines.error, ["patreon-callback: Deployed identity, status or JWT policy differs from main"]);
});

test("audit rejects the deploy token as a fallback and accepts only its own workflow secret", async () => {
  const script = fileURLToPath(new URL("./deploy-hosting-functions.mjs", import.meta.url));
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: "deployment-test-token" };
  delete env.SUPABASE_EDGE_READ_TOKEN;
  delete env.GITHUB_SHA;
  const missing = spawnSync(process.execPath, [script, "audit"], { env, encoding: "utf8", windowsHide: true });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SUPABASE_EDGE_READ_TOKEN read-only secret is missing/u);
  const reused = spawnSync(process.execPath, [script, "audit"], {
    env: { ...env, SUPABASE_EDGE_READ_TOKEN: env.SUPABASE_ACCESS_TOKEN }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(reused.status, 1);
  assert.match(reused.stderr, /requires a separate read-only token/u);

  const workflow = (await readFile(new URL("../.github/workflows/deploy-hosting-functions.yml", import.meta.url), "utf8")).replace(/\r\n/gu, "\n");
  const auditJob = workflow.split("\n  audit:\n")[1];
  assert.match(auditJob, /SUPABASE_EDGE_READ_TOKEN: \$\{\{ secrets\.SUPABASE_EDGE_READ_TOKEN \}\}/u);
  assert.doesNotMatch(auditJob, /SUPABASE_ACCESS_TOKEN/u);
  assert.match(workflow.split("\n  audit:\n")[0], /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/u);
});

test("audit bounds streamed bytes, source parts and the function inventory", async () => {
  const oversized = auditFixture({
    stop: "body",
    body: () => new Response(new ReadableStream({ start(stream) {
      stream.enqueue(new Uint8Array(8 * 1024 * 1024));
      stream.enqueue(new Uint8Array(1));
      stream.close();
    } })),
  });
  await assert.rejects(oversized.run(), /Edge function/u);
  oversized.assertRequests();
  assert.deepEqual(oversized.lines.error, ["patreon-callback: Supabase response exceeds its byte limit"]);

  const tooManyParts = auditFixture({
    stop: "body", files: Array.from({ length: 101 }, (_, index) => ["source/patreon-callback/file-" + index + ".ts", ""]),
  });
  await assert.rejects(tooManyParts.run(), /Edge function/u);
  tooManyParts.assertRequests();
  assert.deepEqual(tooManyParts.lines.error, ["patreon-callback: Supabase bundle exceeds its part limit"]);

  const tooManyFunctions = auditFixture({
    stop: "inventory", inventory: Array.from({ length: 101 }, (_, index) => ({ slug: "external_" + index })),
  });
  await assert.rejects(tooManyFunctions.run(), /oversized Supabase function inventory/u);
  tooManyFunctions.assertRequests();
});

test("audit aborts a stalled source stream when the overall time budget expires", async () => {
  const abort = new AbortController();
  const stalled = auditFixture({
    stop: "body", deadline: abort.signal,
    body: (signal) => new Response(new ReadableStream({ start(stream) {
      signal.addEventListener("abort", () => stream.error(signal.reason), { once: true });
      queueMicrotask(() => abort.abort());
    } })),
  });
  await assert.rejects(stalled.run(), /Edge function/u);
  stalled.assertRequests();
  assert.deepEqual(stalled.lines.error, ["patreon-callback: Edge audit time limit exceeded"]);
});

test("the independent main-only audit job runs after a failed deploy", async () => {
  const workflow = (await readFile(new URL("../.github/workflows/deploy-hosting-functions.yml", import.meta.url), "utf8")).replace(/\r\n/gu, "\n");
  const auditJob = workflow.split("\n  audit:\n")[1];
  assert.match(auditJob, /^    needs: deploy\n    if: \$\{\{ !cancelled\(\) && github\.ref == 'refs\/heads\/main'/u);
  assert.match(auditJob, /run: node scripts\/deploy-hosting-functions\.mjs audit/u);
  assert.doesNotMatch(auditJob, /success\(\)|needs\.deploy\.result/u);
});