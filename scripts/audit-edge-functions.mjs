import path from "node:path";

const API = "https://api.supabase.com/v1/projects/";
const TIME_LIMIT_MS = 240_000;
const REQUEST_LIMIT_MS = 15_000;
const MAX_FUNCTIONS = 100;
const MAX_SOURCE_FILES = 100;
const MAX_JSON = 256 * 1024;
const MAX_BUNDLE = 8 * 1024 * 1024;
const MAX_SOURCE = 1024 * 1024;
const MAX_HEADERS = 8192;
const supabaseSlug = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

async function readBytes(response, limit, signal) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Supabase response exceeds its byte limit");
  }
  if (!response.body) throw new Error("Supabase response is missing a body");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    signal.throwIfAborted();
    size += chunk.byteLength;
    if (size > limit) throw new Error("Supabase response exceeds its byte limit");
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, size);
}

function parseJson(bytes) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("Invalid Supabase JSON");
  }
}

function contentParameter(header, name) {
  const match = header.match(new RegExp("(?:^|;)\\s*" + name + "\\s*=\\s*(?:\"([^\"\\r\\n]*)\"|([^;\\s]+))\\s*(?=;|$)", "iu"));
  return match?.[1] ?? match?.[2];
}

function rawPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) throw new Error("Invalid Supabase source path");
  if (value.startsWith("file://")) {
    if (!value.startsWith("file:///") || /[?#]/u.test(value)) throw new Error("Invalid Supabase file URL");
    value = decodeURIComponent(value.slice("file://".length));
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized.endsWith("/") || /[\u0000-\u001f\u007f]/u.test(normalized) || normalized.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("Invalid Supabase source path");
  }
  return path.posix.normalize("/" + normalized);
}

function partHeaders(buffer) {
  const headers = new Map();
  for (const line of decoder.decode(buffer).split("\r\n")) {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).trim().toLowerCase();
    if (colon < 1 || !/^[a-z0-9-]+$/u.test(name) || headers.has(name)) throw new Error("Invalid Supabase multipart header");
    headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

function findDelimiter(bytes, start, delimiter) {
  for (let i = bytes.indexOf(delimiter, start); i !== -1; i = bytes.indexOf(delimiter, i + 1)) {
    const suffix = bytes.toString("ascii", i + delimiter.length, i + delimiter.length + 2);
    if (suffix === "\r\n" || suffix === "--") return i;
  }
  throw new Error("Supabase multipart response has no closing boundary");
}

function sourcePartPath(headers, disposition) {
  const supabasePath = headers.get("supabase-path");
  if (supabasePath) return supabasePath;
  const extended = contentParameter(disposition, "filename\\*");
  if (extended !== undefined) {
    const name = /^utf-8'[^']*'(.*)$/iu.exec(extended)?.[1];
    if (name === undefined) throw new Error("Invalid Supabase multipart filename");
    return decodeURIComponent(name);
  }
  return contentParameter(disposition, "filename");
}

function bundle(bytes, contentType, metadata, name) {
  const boundary = contentType.length <= 512 ? contentParameter(contentType, "boundary") : undefined;
  if (!/^multipart\/(?:form-data|mixed)(?:;|$)/iu.test(contentType) || !boundary || !/^[A-Za-z0-9'()+_,./:=?-]{1,70}$/u.test(boundary)) {
    throw new Error("Invalid Supabase multipart content type");
  }

  const opening = Buffer.from("--" + boundary);
  const delimiter = Buffer.from("\r\n--" + boundary);
  if (!bytes.subarray(0, opening.length).equals(opening)) throw new Error("Invalid Supabase multipart opening boundary");

  let offset = opening.length;
  let bundleMetadata;
  const files = new Map();
  for (let part = 0; ; part++) {
    const marker = bytes.toString("ascii", offset, offset + 2);
    if (marker === "--") {
      const rest = bytes.toString("ascii", offset + 2);
      if (rest !== "" && rest !== "\r\n") throw new Error("Unexpected Supabase multipart epilogue");
      break;
    }
    if (marker !== "\r\n") throw new Error("Invalid Supabase multipart boundary");
    if (part >= MAX_SOURCE_FILES + 1) throw new Error("Supabase bundle exceeds its part limit");
    const headerStart = offset + 2;
    const headerEnd = bytes.indexOf("\r\n\r\n", headerStart);
    if (headerEnd < 0 || headerEnd - headerStart > MAX_HEADERS) throw new Error("Invalid Supabase multipart headers");
    const headers = partHeaders(bytes.subarray(headerStart, headerEnd));
    const next = findDelimiter(bytes, headerEnd + 4, delimiter);
    const body = bytes.subarray(headerEnd + 4, next);
    offset = next + delimiter.length;

    const disposition = headers.get("content-disposition") ?? "";
    const filename = sourcePartPath(headers, disposition);
    if (filename === undefined && contentParameter(disposition, "name") === "metadata") {
      if (bundleMetadata !== undefined || body.length > MAX_HEADERS) throw new Error("Invalid Supabase bundle metadata");
      bundleMetadata = parseJson(body);
      if (!bundleMetadata || typeof bundleMetadata !== "object" || Array.isArray(bundleMetadata)) throw new Error("Invalid Supabase bundle metadata");
      continue;
    }
    if (filename === undefined || body.length > MAX_SOURCE) throw new Error("Invalid or oversized Supabase source part");
    if (files.size >= MAX_SOURCE_FILES) throw new Error("Supabase bundle exceeds its source file limit");
    const key = rawPath(filename);
    if (files.has(key)) throw new Error("Duplicate Supabase source path");
    files.set(key, decoder.decode(body).replace(/\r\n/gu, "\n"));
  }

  // The multipart metadata names the Deno entry point. Older bundles can use
  // the function metadata instead. Never infer the entry point from a file.
  const entrypoint = rawPath(bundleMetadata?.deno2_entrypoint_path ?? bundleMetadata?.entrypoint_path ?? metadata.entrypoint_path);
  const directory = path.posix.dirname(entrypoint);
  function isMainEntrypoint(file) {
    const mount = path.posix.basename(path.posix.dirname(file));
    return path.posix.basename(file) === "index.ts" && [name, "source", "src"].includes(mount);
  }
  if (!isMainEntrypoint(entrypoint) || !files.has(entrypoint) ||
      (metadata.entrypoint_path && !isMainEntrypoint(rawPath(metadata.entrypoint_path)))) {
    throw new Error("Deployed entry point differs from main");
  }
  const uploaded = new Map();
  for (const [file, source] of files) {
    const local = path.posix.join(name, path.posix.relative(directory, file));
    if (local.startsWith("../") || uploaded.has(local)) throw new Error("Invalid or duplicate Supabase bundle path");
    uploaded.set(local, source);
  }
  return uploaded;
}

function validateInventory(inventory) {
  if (!Array.isArray(inventory) || inventory.length > MAX_FUNCTIONS) throw new Error("Invalid or oversized Supabase function inventory");
  const names = new Set();
  for (const row of inventory) {
    if (typeof row?.slug !== "string" || !supabaseSlug.test(row.slug) || names.has(row.slug)) {
      throw new Error("Invalid or duplicate Supabase function slug");
    }
    names.add(row.slug);
  }
  return names;
}

function requireMatchingMetadata(metadata, name, jwt) {
  if (metadata?.slug !== name || metadata.status !== "ACTIVE" || metadata.verify_jwt !== jwt ||
      !Number.isSafeInteger(metadata.version) || metadata.version < 1) {
    throw new Error("Deployed identity, status or JWT policy differs from main");
  }
}

export async function auditEdgeFunctions({
  projectRef, token, policies, expectedSources, request = fetch, log = console,
  deadline = AbortSignal.timeout(TIME_LIMIT_MS),
}) {
  if (!token || token.length > 8192 || /\s/u.test(token)) throw new Error("SUPABASE_EDGE_READ_TOKEN read-only secret is missing or invalid");
  if (policies.size === 0 || policies.size > MAX_FUNCTIONS) throw new Error("Website Edge function count exceeds the audit limit");
  const base = API + projectRef + "/functions";
  async function read(resource = "", accept = "application/json", limit = MAX_JSON) {
    const timeout = AbortSignal.timeout(REQUEST_LIMIT_MS);
    const signal = AbortSignal.any([deadline, timeout]);
    try {
      signal.throwIfAborted();
      const response = await request(base + resource, {
        method: "GET", headers: { authorization: "Bearer " + token, accept }, redirect: "error", signal,
      });
      if (response.status !== 200 || response.headers.has("content-range")) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Supabase Edge audit read returned HTTP " + response.status);
      }
      const contentType = response.headers.get("content-type") ?? "";
      return { bytes: await readBytes(response, limit, signal), contentType };
    } catch (error) {
      if (deadline.aborted) throw new Error("Edge audit time limit exceeded");
      if (timeout.aborted) throw new Error("Supabase Edge audit request timed out");
      throw error;
    }
  }
  async function json(resource) {
    return parseJson((await read(resource)).bytes);
  }

  const names = validateInventory(await json());
  const outside = [...names].filter((name) => !policies.has(name)).sort();
  if (outside.length) log.warn("Deployed outside website main: " + outside.join(", "));

  let failed = 0;
  for (const [name, jwt] of policies) {
    try {
      if (deadline.aborted) throw new Error("Edge audit time limit exceeded");
      if (!names.has(name)) throw new Error("Function is absent from the live inventory");
      const expected = await expectedSources(name);
      const resource = "/" + name;
      const before = await json(resource);
      requireMatchingMetadata(before, name, jwt);
      const body = await read(resource + "/body", "multipart/form-data", MAX_BUNDLE);
      const actual = bundle(body.bytes, body.contentType, before, name);
      const after = await json(resource);
      requireMatchingMetadata(after, name, jwt);
      if (before.id !== after.id || before.version !== after.version || before.ezbr_sha256 !== after.ezbr_sha256 ||
          before.entrypoint_path !== after.entrypoint_path) {
        throw new Error("Live function changed during source verification");
      }
      // Some Supabase bundles omit type-only modules. Every runtime file must
      // exist, and every returned file, including type-only ones, must match.
      if ([...expected.runtime.keys()].some((file) => !actual.has(file)) ||
          [...actual].some(([file, source]) => expected.all.get(file) !== source)) {
        throw new Error("Deployed source bundle differs from main");
      }
      log.log(name + ": v" + after.version + ", entry point, source bundle and JWT policy verified");
    } catch (error) {
      failed++;
      log.error(name + ": " + error.message);
    }
  }
  if (failed) throw new Error(failed + " Edge function(s) could not be verified");
}