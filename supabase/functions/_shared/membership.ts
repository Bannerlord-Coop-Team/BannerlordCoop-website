// Closed website/CP contract. Provider IDs and evidence never belong in public UI DTOs.
export const POLICY_VERSION = "patreon-paid-usd20-v1" as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const IDENTIFIER = /^[1-9][0-9]{0,31}$/u;
export const DECIMAL = /^(0|[1-9][0-9]{0,19})$/u;
export const HASH = /^[a-f0-9]{64}$/u;
export const FRESHNESS_MS = 86_400_000;
export type Verification = "qualifying" | "nonqualifying" | "unknown" | "review_required" | "unverified";
export type Evidence = { verification: Verification; campaignId: string | null; memberId: string | null; tierIds: string[]; verifiedAt: string | null; paidThroughAt: string | null; policyVersion: typeof POLICY_VERSION; evidenceSha256: string | null };
export type Snapshot = Evidence & { version: 1; accountId: string; discordUserId: string | null; patreonUserId: string | null; linkGeneration: string; revision: string; linkState: "linked" | "unlinked" | "identity_changed" | "account_deleted" };
export type Policy = { campaignId: string; qualifyingTierIds: string[]; currency: "USD"; minimumCents: 2000; policyVersion: typeof POLICY_VERSION };
export function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
export function timestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
export function parsePolicy(value: string | undefined): Policy | null {
    if (value === undefined || value === "") return null;
    if (value.length > 4096) throw new Error("Invalid membership policy");
    const p: unknown = JSON.parse(value);
    if (!record(p) || !exact(p, ["campaignId", "qualifyingTierIds", "currency", "minimumCents", "policyVersion"]) || typeof p.campaignId !== "string" || !IDENTIFIER.test(p.campaignId) || p.currency !== "USD" || p.minimumCents !== 2000 || p.policyVersion !== POLICY_VERSION || !Array.isArray(p.qualifyingTierIds) || p.qualifyingTierIds.length < 1 || p.qualifyingTierIds.length > 50 || !p.qualifyingTierIds.every(id => typeof id === "string" && IDENTIFIER.test(id)) || new Set(p.qualifyingTierIds).size !== p.qualifyingTierIds.length) throw new Error("Invalid membership policy");
    return p as Policy;
}
export function currentDiscord(user: unknown): string | null {
    if (!record(user) || !Array.isArray(user.identities)) throw new Error("Authoritative identities unavailable");
    const identities = user.identities.filter(i => record(i) && i.provider === "discord");
    if (identities.length === 0) return null;
    if (identities.length !== 1) throw new Error("Conflicting Discord identities");
    const identity = identities[0];
    if (!record(identity) || !record(identity.identity_data)) throw new Error("Invalid Discord identity");
    const ids = [identity.identity_data.provider_id, identity.identity_data.sub, identity.identity_data.id].filter(v => v !== undefined);
    if (!ids.length || !ids.every(v => typeof v === "string" && /^[0-9]{17,20}$/u.test(v) && v === ids[0])) throw new Error("Conflicting Discord identity");
    return ids[0] as string;
}
export async function sha256(value: string): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join(""); }
export type JsonReadDiagnostics = {
    phase: "content_type" | "missing_body" | "body_read" | "body_timeout" | "body_size" | "body_cleanup" | "utf8_decode" | "json_parse";
    contentType: "application/json" | "application/vnd.api+json" | "text/html" | "text/plain" | "missing" | "other";
    status: number; bytesRead: number; maxBytes: number; elapsedMs: number;
};
export async function boundedJson(response: Response, max = 65_536, onFailure?: (details: JsonReadDiagnostics) => void): Promise<unknown> {
    const started = Date.now();
    let phase: JsonReadDiagnostics["phase"] = "content_type";
    let length = 0;
    const rawType = response.headers.get("content-type")?.toLowerCase();
    const mediaType = rawType?.split(";", 1)[0].trim();
    // Only allowlisted media types and numeric measurements may leave this reader.
    const contentType: JsonReadDiagnostics["contentType"] = !mediaType ? "missing"
        : mediaType === "application/json" || mediaType === "application/vnd.api+json" || mediaType === "text/html" || mediaType === "text/plain" ? mediaType : "other";
    try {
        if (!rawType?.startsWith("application/json")) throw new Error("Invalid JSON response");
        phase = "missing_body";
        if (!response.body) throw new Error("Invalid JSON response");
        phase = "body_read";
        const deadline = Date.now() + 4_000;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        try {
            while (true) {
                const remaining = deadline - Date.now();
                if (remaining <= 0) { phase = "body_timeout"; throw new Error("Body deadline exceeded"); }
                let timer: ReturnType<typeof setTimeout> | undefined;
                const part = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
                    timer = setTimeout(() => { phase = "body_timeout"; reject(new Error("Body deadline exceeded")); }, remaining);
                })]).finally(() => clearTimeout(timer));
                if (part.done) break;
                length += part.value.length;
                if (length > max) { phase = "body_size"; throw new Error("Response too large"); }
                chunks.push(part.value);
            }
        } finally {
            try { await reader.cancel(); }
            catch (error) { phase = "body_cleanup"; throw error; }
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        phase = "utf8_decode";
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        phase = "json_parse";
        return JSON.parse(text);
    } catch (error) {
        // Never pass exception messages, response bodies, headers, URLs, or credentials.
        try { onFailure?.({ phase, contentType, status: response.status, bytesRead: length, maxBytes: max, elapsedMs: Date.now() - started }); }
        catch { /* Diagnostics must not change the request result. */ }
        throw error;
    }
}
export function parseSnapshot(value: unknown): Snapshot {
    if (!record(value) || !exact(value, ["version", "accountId", "discordUserId", "patreonUserId", "linkGeneration", "revision", "linkState", "verification", "campaignId", "memberId", "tierIds", "verifiedAt", "paidThroughAt", "policyVersion", "evidenceSha256"]) || value.version !== 1 || typeof value.accountId !== "string" || !UUID.test(value.accountId) || typeof value.linkGeneration !== "string" || !DECIMAL.test(value.linkGeneration) || typeof value.revision !== "string" || !DECIMAL.test(value.revision) || !["linked", "unlinked", "identity_changed", "account_deleted"].includes(value.linkState as string) || !["qualifying", "nonqualifying", "unknown", "review_required", "unverified"].includes(value.verification as string) || value.policyVersion !== POLICY_VERSION) throw new Error("Invalid membership snapshot");
    if (value.memberId !== null && (typeof value.memberId !== "string" || !UUID.test(value.memberId))) throw new Error("Invalid member identifier");
    for (const field of ["patreonUserId", "campaignId"]) if (value[field] !== null && (typeof value[field] !== "string" || !IDENTIFIER.test(value[field] as string))) throw new Error("Invalid identifier");
    if (value.discordUserId !== null && (typeof value.discordUserId !== "string" || !/^[0-9]{17,20}$/u.test(value.discordUserId))) throw new Error("Invalid Discord ID");
    if (!Array.isArray(value.tierIds) || value.tierIds.length > 50 || !value.tierIds.every(id => typeof id === "string" && IDENTIFIER.test(id)) || new Set(value.tierIds).size !== value.tierIds.length) throw new Error("Invalid tiers");
    for (const field of ["verifiedAt", "paidThroughAt"]) if (value[field] !== null && !timestamp(value[field])) throw new Error("Invalid timestamp");
    if (value.evidenceSha256 !== null && (typeof value.evidenceSha256 !== "string" || !HASH.test(value.evidenceSha256))) throw new Error("Invalid digest");
    return value as Snapshot;
}
export function validUntil(s: Evidence) { return s.verifiedAt === null ? null : new Date(Math.min(Date.parse(s.verifiedAt) + FRESHNESS_MS, s.paidThroughAt === null ? Infinity : Date.parse(s.paidThroughAt))).toISOString(); }
