// Bounded client for Boosty's unofficial, undocumented internal API. Only the fixed subscriber
// route below exists; no caller supplies a path, host or query. Checked against the real responses in
// tests/fixtures/boosty.
import { createHash } from "node:crypto";
import { boundedJson, record } from "./membership.ts";
import { BOOSTY_BLOG, BOOSTY_IDENTIFIER } from "./funding-provider.ts";
import { fetchWithCreatorToken, type CreatorTokenProvider } from "./patreon-creator-token.ts";
import type { BoostyPriceField } from "./boosty-policy.ts";

export const BOOSTY_API_ORIGIN = "https://api.boosty.to";
export const SUBSCRIBER_PAGE_SIZE = 100;
export const MAX_SUBSCRIBER_PAGES = 50;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OFFSET = SUBSCRIBER_PAGE_SIZE * MAX_SUBSCRIBER_PAGES;
const MAX_EMAIL_LENGTH = 320;
const USER_AGENT = "BannerlordCoop - website membership sync";
const STATUS = /^[a-z_]{1,32}$/u;

/** Boosty refused the creator credential (HTTP 401/403 after one token replacement). */
export class BoostyAuthError extends Error {}

/** Builds the exact URL of the one allowlisted route, a subscriber page; anything else is refused. */
export function subscribersUrl(blog: string, offset: number): URL {
    if (!BOOSTY_BLOG.test(blog) || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new Error("Invalid Boosty route");
    const url = new URL(`/v1/blog/${blog}/subscribers`, BOOSTY_API_ORIGIN);
    for (const [key, value] of [["limit", String(SUBSCRIBER_PAGE_SIZE)], ["offset", String(offset)], ["sort_by", "on_time"], ["order", "gt"], ["with_follow", "false"]]) url.searchParams.append(key, value);
    return url;
}

// `status` is Boosty's own state word ("active", "paused", "inactive"); `offTime` is when access ends or ended.
// `emailSha256` is the SHA-256 of the trimmed, lower-case email; the raw email is never kept.
export type BoostySubscriber = {
    id: string; emailSha256: string | null; subscribed: boolean | null; status: string | null; offTime: string | null; blacklisted: boolean | null; levelId: string | null; price: number | null;
};
export type BoostySubscriberPage = { subscribers: BoostySubscriber[]; total: number };

/** Reads an optional boolean: absent is the given default, any other type is unknown (null). */
function flag(value: unknown, absent: boolean | null): boolean | null {
    return value === undefined ? absent : typeof value === "boolean" ? value : null;
}

/** Converts Boosty Unix seconds into a UTC millisecond timestamp, or null when absent or implausible. */
function unixSeconds(value: unknown): string | null {
    if (!Number.isSafeInteger(value) || (value as number) < 1_500_000_000 || (value as number) > 4_000_000_000) return null;
    return new Date((value as number) * 1000).toISOString();
}

/** Hashes a subscriber's normalized email for matching, or null when it is missing or implausible. */
function emailSha256(value: unknown): string | null {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    return email.length === 0 || email.length > MAX_EMAIL_LENGTH ? null : createHash("sha256").update(email).digest("hex");
}

/** Reads the configured price of a subscriber's level, or null when missing or malformed. */
function levelPrice(level: Record<string, unknown>, field: BoostyPriceField): number | null {
    const value = field === "price" ? level.price : record(level.currencyPrices) ? level.currencyPrices[field] : undefined;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parses one subscriber page. A subscriber without a valid id refuses the whole page. */
export function parseSubscriberPage(value: unknown, field: BoostyPriceField): BoostySubscriberPage {
    if (!record(value) || !Array.isArray(value.data) || value.data.length > SUBSCRIBER_PAGE_SIZE || !Number.isSafeInteger(value.total) || (value.total as number) < 0) throw new Error("Invalid Boosty subscriber page");
    const subscribers = value.data.map(entry => {
        if (!record(entry) || !Number.isSafeInteger(entry.id) || !BOOSTY_IDENTIFIER.test(String(entry.id))) throw new Error("Invalid Boosty subscriber");
        const level = record(entry.level) ? entry.level : null;
        const levelId = level && Number.isSafeInteger(level.id) && (level.id as number) > 0 ? String(level.id)
            : Number.isSafeInteger(entry.levelId) && (entry.levelId as number) > 0 ? String(entry.levelId) : null;
        return { id: String(entry.id), emailSha256: emailSha256(entry.email), subscribed: flag(entry.subscribed, null), status: typeof entry.status === "string" && STATUS.test(entry.status) ? entry.status : null,
            offTime: unixSeconds(entry.offTime), blacklisted: flag(entry.isBlackListed, false), levelId, price: level ? levelPrice(level, field) : null };
    });
    return { subscribers, total: value.total as number };
}

export interface BoostyApi {
    subscribers(offset: number): Promise<BoostySubscriberPage>;
}

/** Creator-authenticated client over the allowlisted route with bounded, strict JSON bodies. */
export function createBoostyApi(options: { blog: string; priceField: BoostyPriceField; credential: CreatorTokenProvider; fetchImplementation?: typeof fetch }): BoostyApi {
    if (!BOOSTY_BLOG.test(options.blog)) throw new Error("Invalid Boosty blog");
    const fetcher = options.fetchImplementation ?? fetch;
    // A 401/403 that survives one token replacement is a credential failure, never "no subscribers".
    async function get(url: URL): Promise<unknown> {
        const response = await fetchWithCreatorToken(options.credential, fetcher, url, { headers: { accept: "application/json", "user-agent": USER_AGENT }, redirect: "error" });
        if (response.status === 401 || response.status === 403) { await response.body?.cancel().catch(() => undefined); throw new BoostyAuthError("Boosty credential rejected"); }
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error("Boosty unavailable"); }
        return boundedJson(response, MAX_RESPONSE_BYTES);
    }
    return {
        subscribers: async offset => parseSubscriberPage(await get(subscribersUrl(options.blog, offset)), options.priceField),
    };
}
