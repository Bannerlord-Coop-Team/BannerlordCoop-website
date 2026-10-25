import { hasExactKeys, isRecord } from "./dto-validation.ts";

// Mirrors the control plane's custom-mods website API (docs/managed-hosting/custom-mods.md section 7 and
// `src/hosting/mods/mod-api-contract.ts`). The Edge Function, the website route handlers and the browser
// client share these closed shapes, so no layer forwards a field, id or size the API does not define.

const MIB = 1_048_576;

/** Exact size of every upload chunk except the last. */
export const MOD_UPLOAD_CHUNK_BYTES = 8 * MIB;
/** Largest accepted compressed module archive. */
export const MOD_UPLOAD_MAXIMUM_BYTES = 100 * MIB;
/** Chunk count of the largest accepted archive. */
export const MOD_UPLOAD_MAXIMUM_CHUNKS = Math.ceil(MOD_UPLOAD_MAXIMUM_BYTES / MOD_UPLOAD_CHUNK_BYTES);
/** Archive bounds the runner enforces (section 8); the website checks them early for clearer feedback. */
export const MOD_ARCHIVE_MAXIMUM_UNCOMPRESSED_BYTES = 512 * MIB;
export const MOD_ARCHIVE_MAXIMUM_ENTRIES = 5_000;
export const MOD_ARCHIVE_MAXIMUM_PATH_BYTES = 240;
export const MOD_ARCHIVE_MAXIMUM_PATH_DEPTH = 16;
export const MOD_ARCHIVE_MAXIMUM_COMPRESSION_RATIO = 100;
/** Entries above this size must stay within the ratio bound on their own. */
export const MOD_ARCHIVE_RATIO_EXEMPT_ENTRY_BYTES = MIB;
/** Archives expanding above this size must stay within the ratio bound in aggregate. */
export const MOD_ARCHIVE_RATIO_EXEMPT_TOTAL_BYTES = 16 * MIB;
export const MOD_SUBMODULE_XML_MAXIMUM_BYTES = MIB;
/** Owner-mod limits (section 4). */
export const MOD_MAXIMUM_ENABLED_OWNER_MODS = 32;
export const MOD_MAXIMUM_INSTALLED_OWNER_MODS = 128;
/** Native, SandBoxCore, SandBox and DedicatedServer.Linux, plus Coop, plus every owner mod. */
export const MOD_MAXIMUM_LIST_ENTRIES = 4 + 1 + MOD_MAXIMUM_INSTALLED_OWNER_MODS;
/** JSON request bodies the adapter accepts on the mods routes. */
export const MAXIMUM_MODS_REQUEST_BYTES = 64 * 1_024;
/** Responses carrying a whole mod list (list, load-order, delete, an installed status) stay within the adapter's bound. */
export const MAXIMUM_MODS_STATE_RESPONSE_BYTES = 8 * MIB;
/** Every other mods response is a small fixed-shape result or error. */
export const MAXIMUM_MODS_SMALL_RESPONSE_BYTES = 64 * 1_024;

/** The my-servers Edge `resource` for `POST ?resource=mods&route=<route>`, one JSON route. */
export const MODS_RESOURCE = "mods";
/** The my-servers Edge `resource` for `PUT ?resource=mod-chunk&uploadId=<UUID>&index=<n>`, one raw chunk. */
export const MOD_CHUNK_RESOURCE = "mod-chunk";

/** The six JSON routes and their fixed control-plane paths; the browser only ever names the key. */
export const MOD_JSON_ROUTES = Object.freeze({
    list: "/api/v1/mods/list",
    "load-order": "/api/v1/mods/load-order",
    uploads: "/api/v1/mods/uploads",
    complete: "/api/v1/mods/uploads/complete",
    status: "/api/v1/mods/uploads/status",
    delete: "/api/v1/mods/delete",
} as const);
export type ModJsonRoute = keyof typeof MOD_JSON_ROUTES;
/** The only binary route; `uploadId` and `index` travel in its query string. */
export const MOD_CHUNK_PATH = "/api/v1/mods/uploads/chunk";

/** Routes that carry a caller-generated `requestId` and replay on resend. */
const MUTATION_ROUTES: ReadonlySet<ModJsonRoute> = new Set(["load-order", "uploads", "complete", "delete"]);

// Unanchored grammars shared by the field validators and the typed error-message parser, so they cannot drift.
const MOD_ID_BODY = String.raw`[A-Za-z0-9_.-]{1,64}`;
const ISSUE_BODY = String.raw`[a-z][a-z-]{0,47}(?::[A-Za-z0-9 _.+-]{1,128})?`;
const MOD_ID_PATTERN = new RegExp(`^${MOD_ID_BODY}$`, "u");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const CALLER_SHA256 = /^[A-Fa-f0-9]{64}$/u;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/u;
const NAME = /^[^\p{C}]+$/u;
const ISSUE = new RegExp(`^${ISSUE_BODY}$`, "u");
/** The suffix the control plane appends to a typed error message: ` Module: <Id>.`, optionally then ` Issue: <issue>.`. */
const REFUSAL_SUFFIX = new RegExp(String.raw` Module: (${MOD_ID_BODY})\.(?: Issue: (${ISSUE_BODY})\.)?$`, "u");
const STATUS = /^[a-z][a-z-]{0,31}$/u;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const CHUNK_INDEX = /^(?:0|[1-9][0-9]{0,2})$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const RESERVED_IDS = new Set(["native", "sandboxcore", "sandbox", "storymode", "custombattle", "multiplayer", "birthanddeath", "navaldlc", "coop", "coopnightly"]);

/** Where a mod's code runs: `server` on the server and in players' games, `players` only in players' games. */
export type ModRunsOn = "server" | "players";
const RUNS_ON_VALUES: ReadonlySet<unknown> = new Set<ModRunsOn>(["server", "players"]);
/** Why the owner cannot change `runsOn`, as C3 defines it today; the parser also keeps a later, unknown reason. */
export type ModRunsOnLockReason = "core-module" | "server-provided" | "runner-unsupported" | "submodule-invalid";
/** A lock reason's shape: a newer control plane may add reasons, which the website shows with generic copy. */
const LOCK_REASON = /^[a-z][a-z-]{0,47}$/u;
// Wire names of the players-only fields (contract C3). Control planes that predate players-only mods send
// none of them, so each shape accepts them as an optional group; a rename changes these lines and the types below.
// Remove the "none" case (and make the fields required) once the control plane's runs-on writer gate is on
// in production and a rollback below it is ruled out (BannerlordCoop-website#384).
const ENTRY_KEYS = ["id", "name", "version", "enabled", "pinned", "required", "sizeBytes", "sha256", "dependsOn", "issues"] as const;
const ENTRY_RUNS_ON_KEYS = ["runsOn", "runsOnDefault", "runsOnLocked"] as const;
const ENTRY_LOCK_REASON_KEY = "runsOnLockReason";
const ORDER_KEYS = ["id", "enabled"] as const;
const ORDER_RUNS_ON_KEY = "runsOn";

/** One installed module as the API reports it; pinned and required modules report an empty version. */
export type ModEntry = {
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    pinned: boolean;
    required: boolean;
    /** Overrides legacy pinned-position behavior; ownership, enabled and deletion rules stay separate. */
    reorderable?: boolean;
    sizeBytes: number;
    sha256: string | null;
    dependsOn: string[];
    issues: string[];
    /** Absent from control planes that predate players-only mods; then the website offers no choice. */
    runsOn?: ModRunsOn;
    /** What a new upload of this id gets; the website warns when the owner picks players on a `server` default. */
    runsOnDefault?: ModRunsOn;
    /** True when the owner cannot change `runsOn`. */
    runsOnLocked?: boolean;
    /** Present exactly when locked: a `ModRunsOnLockReason`, or a newer reason this website does not know. */
    runsOnLockReason?: ModRunsOnLockReason | (string & {});
};
/** `{ revision, restartRequired, mods }`, returned by list and every synchronous mutation. */
export type ModsState = { revision: string; restartRequired: boolean; mods: ModEntry[] };
/** One requested position; an omitted `runsOn` keeps the mod's current value, so it is sent only when the owner changed it. */
export type ModOrderEntry = { id: string; enabled: boolean; runsOn?: ModRunsOn };
export type ModUploadManifest = { id: string; name: string; version: string };
export type ModUploadSession = { uploadId: string; chunkBytes: number; chunkCount: number; expiresAt: string; replaces: boolean };
export type ModChunkReceipt = { receivedChunks: number; receivedBytes: number };
/** Statuses the website knows; the API may add more, which clients reconcile through `list`. */
export const MOD_UPLOAD_ACTIVE_STATUSES = ["receiving", "validating", "transferring", "installing"] as const;
export type ModUploadStatus =
    | { uploadId: string; status: "installed"; state: ModsState }
    | { uploadId: string; status: "rejected"; error: string }
    | { uploadId: string; status: string };

/** The validated JSON body of one route, exactly as the control plane receives it. */
export type ModsRequest =
    | { route: "list"; body: { serverId: string } }
    | { route: "load-order"; body: { requestId: string; serverId: string; expectedRevision: string; mods: ModOrderEntry[] } }
    | { route: "uploads"; body: { requestId: string; serverId: string; expectedRevision: string; manifest: ModUploadManifest; totalBytes: number; sha256: string } }
    | { route: "complete"; body: { requestId: string; uploadId: string; expectedRevision: string } }
    | { route: "status"; body: { serverId: string; uploadId: string } }
    | { route: "delete"; body: { requestId: string; serverId: string; expectedRevision: string; modId: string } };

/** Whether a value names one of the six JSON routes. */
export function isModJsonRoute(value: unknown): value is ModJsonRoute {
    return typeof value === "string" && Object.hasOwn(MOD_JSON_ROUTES, value);
}

/** Whether a route carries a caller `requestId` that its resend must repeat. */
export function isModMutationRoute(route: ModJsonRoute): boolean {
    return MUTATION_ROUTES.has(route);
}

/** Whether a value has the module id shape (owner, image or dependency id). */
export function isModId(value: unknown): value is string {
    return typeof value === "string" && MOD_ID_PATTERN.test(value);
}

/** Whether a value has the closed error-code shape the API and the website's routes use. */
export function isModErrorCode(value: unknown): value is string {
    return typeof value === "string" && ERROR_CODE.test(value);
}

/** Whether an id is reserved for core or image modules, compared case-insensitively, or is dot-only. */
export function isReservedModId(id: string): boolean {
    const folded = id.toLowerCase();
    return RESERVED_IDS.has(folded) || folded.startsWith("dedicatedserver.") || /^\.+$/u.test(id);
}

/** Whether an id may name an owner-installed module. */
export function isOwnerModId(value: unknown): value is string {
    return isModId(value) && !isReservedModId(value);
}

/** Whether a value is a `SubModule.xml` `Name` the API accepts: printable, trimmed, at most 128 characters. */
export function isModName(value: unknown): value is string {
    return typeof value === "string" && NAME.test(value) && value.trim() === value && Array.from(value).length <= 128;
}

/** Whether a value is a `SubModule.xml` `Version` the API accepts, for example `v1.2.0`. */
export function isModVersion(value: unknown): value is string {
    return typeof value === "string" && VERSION.test(value);
}

/** Whether a value is a UUID of the form the website and control plane generate. */
export function isModUuid(value: unknown): value is string {
    return typeof value === "string" && UUID.test(value);
}

/** Whether a value is a lowercase sha256 hex digest (also the shape of a list revision). */
export function isSha256(value: unknown): value is string {
    return typeof value === "string" && SHA256.test(value);
}

/** Returns the chunk count of an archive of `totalBytes`. */
export function modChunkCount(totalBytes: number): number {
    return Math.ceil(totalBytes / MOD_UPLOAD_CHUNK_BYTES);
}

/** Returns the exact byte length of chunk `index` of an archive of `totalBytes`, or 0 when out of range. */
export function modChunkLength(totalBytes: number, index: number): number {
    const count = modChunkCount(totalBytes);
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) return 0;
    return index < count - 1 ? MOD_UPLOAD_CHUNK_BYTES : totalBytes - (count - 1) * MOD_UPLOAD_CHUNK_BYTES;
}

/** Validates one route's JSON body against its strict shape; throws on any unknown key or bad value. */
export function parseModsRequest(route: ModJsonRoute, value: unknown): ModsRequest {
    if (!isRecord(value)) throw new Error("Invalid mods request");
    switch (route) {
        case "list":
            exact(value, ["serverId"]);
            requireUuid(value.serverId);
            return { route, body: { serverId: value.serverId } };
        case "load-order":
            exact(value, ["requestId", "serverId", "expectedRevision", "mods"]);
            requireMutationIdentity(value);
            return { route, body: { requestId: value.requestId, serverId: value.serverId, expectedRevision: value.expectedRevision, mods: parseLoadOrder(value.mods) } };
        case "uploads":
            exact(value, ["requestId", "serverId", "expectedRevision", "manifest", "totalBytes", "sha256"]);
            requireMutationIdentity(value);
            if (!Number.isSafeInteger(value.totalBytes) || (value.totalBytes as number) < 1 || (value.totalBytes as number) > MOD_UPLOAD_MAXIMUM_BYTES) throw new Error("Invalid archive size");
            if (typeof value.sha256 !== "string" || !CALLER_SHA256.test(value.sha256)) throw new Error("Invalid archive digest");
            return { route, body: {
                requestId: value.requestId, serverId: value.serverId, expectedRevision: value.expectedRevision,
                manifest: parseUploadManifest(value.manifest), totalBytes: value.totalBytes as number, sha256: value.sha256.toLowerCase(),
            } };
        case "complete":
            exact(value, ["requestId", "uploadId", "expectedRevision"]);
            requireUuid(value.requestId);
            requireUuid(value.uploadId);
            requireRevision(value.expectedRevision);
            return { route, body: { requestId: value.requestId, uploadId: value.uploadId, expectedRevision: value.expectedRevision } };
        case "status":
            exact(value, ["serverId", "uploadId"]);
            requireUuid(value.serverId);
            requireUuid(value.uploadId);
            return { route, body: { serverId: value.serverId, uploadId: value.uploadId } };
        case "delete":
            exact(value, ["requestId", "serverId", "expectedRevision", "modId"]);
            requireMutationIdentity(value);
            if (!isModId(value.modId)) throw new Error("Invalid module id");
            return { route, body: { requestId: value.requestId, serverId: value.serverId, expectedRevision: value.expectedRevision, modId: value.modId } };
    }
}

/** Validates a chunk's query values: an upload UUID and a canonical zero-based index below the chunk maximum. */
export function parseModChunkQuery(uploadId: unknown, index: unknown): { uploadId: string; index: number } {
    requireUuid(uploadId);
    if (typeof index !== "string" || !CHUNK_INDEX.test(index) || Number(index) >= MOD_UPLOAD_MAXIMUM_CHUNKS) throw new Error("Invalid chunk index");
    return { uploadId, index: Number(index) };
}

/** Validates a chunk digest header (either case) and returns it lowercase. */
export function parseModChunkDigest(value: unknown): string {
    if (typeof value !== "string" || !CALLER_SHA256.test(value)) throw new Error("Invalid chunk digest");
    return value.toLowerCase();
}

/** Validates a route's result shape; the upload session is also checked against the archive size it was created for. */
export function parseModsResult(route: ModJsonRoute, value: unknown, request?: ModsRequest): unknown {
    switch (route) {
        case "list":
        case "load-order":
        case "delete":
            return parseModsState(value);
        case "uploads":
            return parseModUploadSession(value, request?.route === "uploads" ? request.body.totalBytes : undefined);
        case "complete":
            return parseModUploadAccepted(value, request?.route === "complete" ? request.body.uploadId : undefined);
        case "status":
            return parseModUploadStatus(value, request?.route === "status" ? request.body.uploadId : undefined);
    }
}

/** Validates a complete mod list: bounded entries with unique ids, and a lowercase sha256 revision. */
export function parseModsState(value: unknown): ModsState {
    if (!isRecord(value)) throw new Error("Invalid mods state");
    exact(value, ["revision", "restartRequired", "mods"]);
    requireRevision(value.revision);
    if (typeof value.restartRequired !== "boolean") throw new Error("Invalid restart flag");
    if (!Array.isArray(value.mods) || value.mods.length < 1 || value.mods.length > MOD_MAXIMUM_LIST_ENTRIES) throw new Error("Invalid mod list");
    const mods = value.mods.map(parseModEntry);
    if (new Set(mods.map((mod) => mod.id.toLowerCase())).size !== mods.length) throw new Error("Duplicate mod id");
    return { revision: value.revision, restartRequired: value.restartRequired, mods };
}

/** Validates an upload session; the chunk geometry must match the fixed chunk size and, when known, the archive size. */
export function parseModUploadSession(value: unknown, totalBytes?: number): ModUploadSession {
    if (!isRecord(value)) throw new Error("Invalid upload session");
    exact(value, ["uploadId", "chunkBytes", "chunkCount", "expiresAt", "replaces"]);
    requireUuid(value.uploadId);
    if (value.chunkBytes !== MOD_UPLOAD_CHUNK_BYTES) throw new Error("Invalid chunk size");
    if (!Number.isSafeInteger(value.chunkCount) || (value.chunkCount as number) < 1 || (value.chunkCount as number) > MOD_UPLOAD_MAXIMUM_CHUNKS) throw new Error("Invalid chunk count");
    if (totalBytes !== undefined && value.chunkCount !== modChunkCount(totalBytes)) throw new Error("Chunk count does not match the archive");
    if (typeof value.expiresAt !== "string" || !ISO_TIMESTAMP.test(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error("Invalid expiry");
    if (typeof value.replaces !== "boolean") throw new Error("Invalid replacement flag");
    return { uploadId: value.uploadId, chunkBytes: value.chunkBytes, chunkCount: value.chunkCount as number, expiresAt: value.expiresAt, replaces: value.replaces };
}

/** Validates a chunk acknowledgement. */
export function parseModChunkReceipt(value: unknown): ModChunkReceipt {
    if (!isRecord(value)) throw new Error("Invalid chunk receipt");
    exact(value, ["receivedChunks", "receivedBytes"]);
    if (!boundedInteger(value.receivedChunks, MOD_UPLOAD_MAXIMUM_CHUNKS) || !boundedInteger(value.receivedBytes, MOD_UPLOAD_MAXIMUM_BYTES)) throw new Error("Invalid chunk receipt");
    return { receivedChunks: value.receivedChunks as number, receivedBytes: value.receivedBytes as number };
}

/** Validates the `202` result of `complete`; an unknown status is kept so the client can reconcile it. */
export function parseModUploadAccepted(value: unknown, uploadId?: string): { uploadId: string; status: string } {
    if (!isRecord(value)) throw new Error("Invalid upload completion");
    exact(value, ["uploadId", "status"]);
    requireUploadId(value.uploadId, uploadId);
    if (typeof value.status !== "string" || !STATUS.test(value.status) || value.status === "receiving") throw new Error("Invalid upload status");
    return { uploadId: value.uploadId as string, status: value.status };
}

/** Validates a status: `error` exactly when rejected, `state` exactly when installed, nothing else otherwise. */
export function parseModUploadStatus(value: unknown, uploadId?: string): ModUploadStatus {
    if (!isRecord(value) || typeof value.status !== "string" || !STATUS.test(value.status)) throw new Error("Invalid upload status");
    requireUploadId(value.uploadId, uploadId);
    const id = value.uploadId as string;
    if (value.status === "installed") {
        exact(value, ["uploadId", "status", "state"]);
        return { uploadId: id, status: "installed", state: parseModsState(value.state) };
    }
    if (value.status === "rejected") {
        exact(value, ["uploadId", "status", "error"]);
        if (typeof value.error !== "string" || !ERROR_CODE.test(value.error)) throw new Error("Invalid rejection code");
        return { uploadId: id, status: "rejected", error: value.error };
    }
    exact(value, ["uploadId", "status"]);
    return { uploadId: id, status: value.status };
}

/** Returns the module and any issue the control plane appends to a typed error message, or null when it names no module. */
export function modRefusalFromErrorMessage(message: string): { modId: string; issue: string | null } | null {
    const match = REFUSAL_SUFFIX.exec(message);
    return match === null ? null : { modId: match[1], issue: match[2] ?? null };
}

/** Whether a value has the installed-mod issue shape (`kind` or `kind:value`). */
export function isModIssue(value: unknown): value is string {
    return typeof value === "string" && ISSUE.test(value);
}

/** Validates one API mod entry and its optional runs-on set; pinned and required are exclusive and image modules carry no digest. */
function parseModEntry(value: unknown): ModEntry {
    if (!isRecord(value)) throw new Error("Invalid mod entry");
    const reportsRunsOn = [...ENTRY_RUNS_ON_KEYS, ENTRY_LOCK_REASON_KEY].some((key) => Object.hasOwn(value, key));
    const reportsReorderable = Object.hasOwn(value, "reorderable");
    const keys = runsOnEntryKeys(reportsRunsOn, value.runsOnLocked === true);
    exact(value, reportsReorderable ? [...keys, "reorderable"] : keys);
    if (reportsReorderable && typeof value.reorderable !== "boolean") throw new Error("Invalid mod reorderable flag");
    if (!isModId(value.id) || !(isModName(value.name) || isModId(value.name))) throw new Error("Invalid mod identity");
    if (value.version !== "" && !isModVersion(value.version)) throw new Error("Invalid mod version");
    if (typeof value.enabled !== "boolean" || typeof value.pinned !== "boolean" || typeof value.required !== "boolean" || (value.pinned && value.required)) {
        throw new Error("Invalid mod flags");
    }
    if (!boundedInteger(value.sizeBytes, MOD_ARCHIVE_MAXIMUM_UNCOMPRESSED_BYTES)) throw new Error("Invalid mod size");
    if (value.sha256 !== null && !isSha256(value.sha256)) throw new Error("Invalid mod digest");
    if (!Array.isArray(value.dependsOn) || value.dependsOn.length > 64 || !value.dependsOn.every(isModId)) throw new Error("Invalid mod dependencies");
    if (!Array.isArray(value.issues) || value.issues.length > 64 || !value.issues.every(isModIssue)) throw new Error("Invalid mod issues");
    const entry: ModEntry = {
        id: value.id, name: value.name as string, version: value.version as string, enabled: value.enabled, pinned: value.pinned, required: value.required,
        sizeBytes: value.sizeBytes as number, sha256: value.sha256 as string | null, dependsOn: [...value.dependsOn], issues: [...value.issues as string[]],
        ...(reportsReorderable ? { reorderable: value.reorderable as boolean } : {}),
    };
    return reportsRunsOn ? { ...entry, ...parseRunsOnFields(value) } : entry;
}

/** Returns the keys an entry must have: none of the runs-on set, or all of it with the lock reason exactly when locked. */
function runsOnEntryKeys(reportsRunsOn: boolean, locked: boolean): readonly string[] {
    if (!reportsRunsOn) return ENTRY_KEYS;
    return locked ? [...ENTRY_KEYS, ...ENTRY_RUNS_ON_KEYS, ENTRY_LOCK_REASON_KEY] : [...ENTRY_KEYS, ...ENTRY_RUNS_ON_KEYS];
}

/** Validates the runs-on set of an entry that reports it: known values, a boolean lock and, when locked, a reason. */
function parseRunsOnFields(value: Record<string, unknown>): Pick<ModEntry, "runsOn" | "runsOnDefault" | "runsOnLocked" | "runsOnLockReason"> {
    if (!isModRunsOn(value.runsOn) || !isModRunsOn(value.runsOnDefault) || typeof value.runsOnLocked !== "boolean") throw new Error("Invalid mod runs-on");
    const fields = { runsOn: value.runsOn, runsOnDefault: value.runsOnDefault, runsOnLocked: value.runsOnLocked };
    if (!value.runsOnLocked) return fields;
    if (typeof value.runsOnLockReason !== "string" || !LOCK_REASON.test(value.runsOnLockReason)) throw new Error("Invalid mod runs-on lock reason");
    return { ...fields, runsOnLockReason: value.runsOnLockReason };
}

/** Whether a value names where a mod's code runs. */
function isModRunsOn(value: unknown): value is ModRunsOn {
    return RUNS_ON_VALUES.has(value);
}

/** Validates a complete requested order: bounded, unique ids, each with its enabled flag and an optional `runsOn` change. */
function parseLoadOrder(value: unknown): ModOrderEntry[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > MOD_MAXIMUM_LIST_ENTRIES) throw new Error("Invalid load order");
    const order = value.map(parseLoadOrderEntry);
    if (new Set(order.map((entry) => entry.id.toLowerCase())).size !== order.length) throw new Error("Duplicate load-order entry");
    return order;
}

/** Validates one requested position; `runsOn` appears only when the owner changed it. */
function parseLoadOrderEntry(entry: unknown): ModOrderEntry {
    if (!isRecord(entry)) throw new Error("Invalid load-order entry");
    const changesRunsOn = Object.hasOwn(entry, ORDER_RUNS_ON_KEY);
    exact(entry, changesRunsOn ? [...ORDER_KEYS, ORDER_RUNS_ON_KEY] : ORDER_KEYS);
    if (!isModId(entry.id) || typeof entry.enabled !== "boolean") throw new Error("Invalid load-order entry");
    if (!changesRunsOn) return { id: entry.id, enabled: entry.enabled };
    if (!isModRunsOn(entry.runsOn)) throw new Error("Invalid load-order entry");
    return { id: entry.id, enabled: entry.enabled, runsOn: entry.runsOn };
}

/** Validates the upload manifest read from `SubModule.xml`. */
function parseUploadManifest(value: unknown): ModUploadManifest {
    if (!isRecord(value)) throw new Error("Invalid upload manifest");
    exact(value, ["id", "name", "version"]);
    if (!isModId(value.id) || !isModName(value.name) || !isModVersion(value.version)) throw new Error("Invalid upload manifest");
    return { id: value.id, name: value.name, version: value.version };
}

/** Requires the request UUID, server UUID and list revision every server mutation carries. */
function requireMutationIdentity(value: Record<string, unknown>): asserts value is Record<string, unknown> & { requestId: string; serverId: string; expectedRevision: string } {
    requireUuid(value.requestId);
    requireUuid(value.serverId);
    requireRevision(value.expectedRevision);
}

/** Requires a result to name a valid upload, and the requested one when it is known. */
function requireUploadId(value: unknown, expected: string | undefined) {
    requireUuid(value);
    if (expected !== undefined && value.toLowerCase() !== expected.toLowerCase()) throw new Error("Result belongs to another upload");
}

/** Requires a UUID. */
function requireUuid(value: unknown): asserts value is string {
    if (!isModUuid(value)) throw new Error("Invalid UUID");
}

/** Requires a list revision. */
function requireRevision(value: unknown): asserts value is string {
    if (!isSha256(value)) throw new Error("Invalid revision");
}

/** Requires exactly the listed keys. */
function exact(value: Record<string, unknown>, keys: readonly string[]) {
    if (!hasExactKeys(value, keys)) throw new Error("Unexpected mods fields");
}

/** Whether a value is a non-negative safe integer no greater than `maximum`. */
function boundedInteger(value: unknown, maximum: number): boolean {
    return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}
