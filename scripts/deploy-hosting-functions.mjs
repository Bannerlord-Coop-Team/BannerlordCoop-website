import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp, mkdir, rm, realpath, stat, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";

export const PROJECT_REF = "wfvqnijwuyqjibhlcrhz";
export const FUNCTIONS = Object.freeze({ "my-servers": true, "control-plane-admin": true, "public-servers": false });
const exec = promisify(execFile);
const edgeName = /^[a-z][a-z0-9-]{1,60}$/u;
const reviewedEdgeImports = new Set(["node:crypto", "node:buffer", "npm:pg@8.16.3", "npm:@aws-sdk/client-s3"]);
const canonical = (source) => source.replace(/\r\n/gu, "\n").trimEnd() + "\n";

// Include transitive shared modules, not just each function's entrypoint.
export async function sources(root, name, { audit = false } = {}) {
  if (audit ? !edgeName.test(name) : !Object.hasOwn(FUNCTIONS, name)) throw new Error("Unsupported hosting function");
  const directory = await realpath(path.join(root, "supabase/functions"));
  for (const config of ["deno.json", "deno.jsonc", name + "/deno.json", name + "/deno.jsonc"]) {
    try { await stat(path.join(directory, config)); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Function runtime configuration requires a deployment recipe update");
  }
  const files = new Map();
  async function visit(relative) {
    if (files.has(relative)) return;
    if (!/^[a-z0-9_/-]+\.ts$/u.test(relative) || relative.split("/").includes("..") || files.size >= 100) {
      throw new Error("Unsupported function dependency");
    }
    const absolute = await realpath(path.join(directory, relative));
    if (!absolute.startsWith(directory + path.sep)) throw new Error("Function dependency leaves its source directory");
    const source = await readFile(absolute, "utf8");
    if (Buffer.byteLength(source) > 1_048_576) throw new Error("Function source is too large");
    files.set(relative, canonical(source));
    const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
    const dependencies = [];
    function inspect(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error("Unsupported function import");
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (!audit || !typeOnly) dependencies.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error("Unsupported dynamic function import");
        dependencies.push(node.arguments[0].text);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
    for (const dependency of dependencies) {
      if (audit && reviewedEdgeImports.has(dependency)) continue;
      if (!dependency.startsWith(".")) throw new Error("External function imports require a deployment recipe update");
      await visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative), dependency)));
    }
  }
  await visit(name + "/index.ts");
  return files;
}

export function sourceDigest(files) {
  return createHash("sha256").update(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

function configuredJwt(config, name) {
  const sections = [...config.matchAll(/\[functions\.([a-z0-9-]+)\]([^[]*)/gu)].filter((match) => match[1] === name);
  const settings = sections[0]?.[2].split("\n").map((line) => line.replace(/#.*/u, "").trim()).filter(Boolean) ?? [];
  const setting = settings[0]?.match(/^verify_jwt\s*=\s*(true|false)$/u);
  if (sections.length !== 1 || settings.length !== 1 || !setting) {
    throw new Error(name + ": JWT policy differs from the reviewed hosting policy");
  }
  return setting[1] === "true";
}

export function checkAuthentication(config) {
  for (const [name, jwt] of Object.entries(FUNCTIONS)) {
    if (configuredJwt(config, name) !== jwt) throw new Error(name + ": JWT policy differs from the reviewed hosting policy");
  }
}

export async function auditedFunctions(root, config) {
  const entries = await readdir(path.join(root, "supabase/functions"), { withFileTypes: true });
  const policies = new Map();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "_shared") continue;
    if (!entry.isDirectory() || !edgeName.test(entry.name)) throw new Error("Unsupported Edge function directory");
    policies.set(entry.name, configuredJwt(config, entry.name));
  }
  if (policies.size === 0) throw new Error("No website Edge functions found");
  return policies;
}

export function matchesDeployment(expected, uploaded, metadata, name, jwt = FUNCTIONS[name]) {
  return metadata?.slug === name && metadata.status === "ACTIVE" && metadata.verify_jwt === jwt
    && Number.isSafeInteger(metadata.version) && metadata.version > 0 && sourceDigest(expected) === sourceDigest(uploaded);
}

export async function boundedJson(response) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 262_144) throw new Error("Supabase verification response is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function metadata(token) {
  const response = await fetch("https://api.supabase.com/v1/projects/" + PROJECT_REF + "/functions", {
    headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Supabase function inventory returned HTTP " + response.status);
  const result = await boundedJson(response);
  if (!Array.isArray(result) || result.length > 100) throw new Error("Invalid Supabase function inventory");
  return result;
}

async function cli(args, root) {
  try {
    await exec("supabase", ["functions", ...args, "--project-ref", PROJECT_REF, "--use-api", "--workdir", root], {
      windowsHide: true, timeout: 120_000, maxBuffer: 1_048_576,
    });
  } catch {
    throw new Error("Supabase CLI " + args[0] + " did not confirm completion");
  }
}

async function uploadedSources(name, options) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bannerlord-hosting-edge-"));
  try {
    await mkdir(path.join(temporary, "supabase"));
    await writeFile(path.join(temporary, "supabase/config.toml"), 'project_id = "hosting-source-verification"\n');
    await cli(["download", name], temporary);
    return await sources(temporary, name, options);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

// Unknown deployment outcomes are checked against the uploaded source before any retry.
export async function ensureDeployment({ name, expected, mode, read, deploy }) {
  let current = await read();
  if (matchesDeployment(expected, current.files, current.metadata, name)) return { ...current.metadata, outcome: "already-current" };
  if (mode === "verify") throw new Error(name + ": deployed source or JWT policy is outdated");
  let uncertain = false;
  try { await deploy(); } catch { uncertain = true; }
  current = await read();
  if (!matchesDeployment(expected, current.files, current.metadata, name)) {
    throw new Error(name + ": deployment could not be verified; reconcile the live function before retrying");
  }
  return { ...current.metadata, outcome: uncertain ? "reconciled" : "deployed" };
}

async function smoke(name) {
  // Exercise routing and the gateway auth policy without an owner session or a server mutation.
  const endpoint = "https://" + PROJECT_REF + ".supabase.co/functions/v1/" + name;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (FUNCTIONS[name]) {
    if (response.status !== 401) throw new Error(name + ": unauthenticated request was not rejected");
  } else {
    if (!response.ok) throw new Error(name + ": public read returned HTTP " + response.status);
    const value = await boundedJson(response);
    if (value?.ok !== true || !Array.isArray(value.result?.items) || value.result.items.length > 100) {
      throw new Error(name + ": public read returned an invalid envelope");
    }
  }
  await response.body?.cancel().catch(() => {});
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (!["plan", "deploy", "verify", "audit"].includes(mode) || extra.length) throw new Error("Use plan|deploy|verify|audit");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Check all hosting APIs against live source; queued runs can skip intermediate commits.
  const names = Object.keys(FUNCTIONS);
  const config = await readFile(path.join(root, "supabase/config.toml"), "utf8");
  checkAuthentication(config);
  if (mode === "plan") {
    console.log(JSON.stringify(await Promise.all(names.map(async (name) => ({ name, sourceSha256: sourceDigest(await sources(root, name)) })))));
    return;
  }
  if (mode === "deploy" && process.env.GITHUB_REF !== "refs/heads/main") throw new Error("Production deployment requires the main GitHub workflow");
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token || token.length > 8192 || /\s/u.test(token)) throw new Error("SUPABASE_ACCESS_TOKEN deployment secret is missing or invalid");
  const commit = (await exec("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true })).stdout.trim();
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) throw new Error("Checkout does not match the workflow source commit");
  async function read(name, options) {
    const before = (await metadata(token)).find((item) => item.slug === name);
    if (!before) throw new Error("Function is absent from the live inventory");
    const files = await uploadedSources(name, options);
    const after = (await metadata(token)).find((item) => item.slug === name);
    if (!after || before.version !== after.version || before.ezbr_sha256 !== after.ezbr_sha256) {
      throw new Error("Live function changed during source verification");
    }
    return { metadata: after, files };
  }
  if (mode === "audit") {
    const policies = await auditedFunctions(root, config);
    const inventory = await metadata(token);
    const outside = inventory.map((item) => item.slug)
      .filter((name) => typeof name === "string" && edgeName.test(name) && !policies.has(name)).sort();
    if (outside.length) console.warn("Deployed outside website main: " + outside.join(", "));
    const options = { audit: true };
    let failed = 0;
    for (const [name, jwt] of policies) {
      try {
        const expected = await sources(root, name, options);
        const live = await read(name, options);
        if (!matchesDeployment(expected, live.files, live.metadata, name, jwt)) {
          throw new Error("Deployed source or JWT policy differs from main");
        }
        console.log(name + ": v" + live.metadata.version + ", runtime source and JWT policy verified");
      } catch (error) {
        failed++;
        console.error(name + ": " + error.message);
      }
    }
    if (failed) throw new Error(failed + " Edge function(s) could not be verified");
    return;
  }
  const receipt = { projectRef: PROJECT_REF, sourceCommit: commit, status: "failed", functions: [] };
  try {
    for (const name of names) {
      const expected = await sources(root, name);
      const result = await ensureDeployment({ name, expected, mode, read: () => read(name),
        deploy: () => cli(["deploy", name], root) });
      await smoke(name);
      receipt.functions.push({ name, version: result.version, verifyJwt: result.verify_jwt,
        sourceSha256: sourceDigest(expected), outcome: result.outcome, smoke: "passed" });
      console.log(name + ": " + result.outcome + ", version " + result.version + ", source and smoke verified");
    }
    receipt.status = "succeeded";
  } finally {
    await writeFile(path.join(root, "supabase-hosting-deployment.json"), JSON.stringify(receipt, null, 2) + "\n");
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, "Supabase hosting deployment: **" + receipt.status + "**\n\nSource: `" + commit + "`\n\n"
        + receipt.functions.map((item) => "- " + item.name + ": v" + item.version + ", " + item.outcome + ", verified\n").join(""), { flag: "a" });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
