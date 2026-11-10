// Reviewed Boosty adapter configuration. The adapter is disabled unless every field is present
// and valid; amount and level checks here are the website adapter's half of the CP policy.
import { exact, record } from "./membership.ts";
import { BOOSTY_BLOG, BOOSTY_IDENTIFIER, BOOSTY_POLICY_VERSION } from "./funding-provider.ts";

export const BOOSTY_PRICE_FIELDS = ["price", "RUB", "USD", "EUR"] as const;
export type BoostyPriceField = typeof BOOSTY_PRICE_FIELDS[number];
export type BoostyPolicy = {
    blog: string; qualifyingLevelIds: string[]; minimumPrice: number; priceField: BoostyPriceField;
    creatorName: string; maximumDropFraction: number; policyVersion: typeof BOOSTY_POLICY_VERSION;
};
const KEYS = ["blog", "qualifyingLevelIds", "minimumPrice", "priceField", "creatorName", "maximumDropFraction", "policyVersion"] as const;

/** Parses BOOSTY_MEMBERSHIP_POLICY_JSON strictly; returns null (adapter disabled) when unset. */
export function parseBoostyPolicy(value: string | undefined): BoostyPolicy | null {
    if (value === undefined || value.trim() === "") return null;
    if (value.length > 4096) throw new Error("Invalid Boosty policy");
    const p: unknown = JSON.parse(value);
    if (!record(p) || !exact(p, KEYS)) throw new Error("Invalid Boosty policy");
    if (typeof p.blog !== "string" || !BOOSTY_BLOG.test(p.blog) || p.policyVersion !== BOOSTY_POLICY_VERSION) throw new Error("Invalid Boosty policy");
    if (!Array.isArray(p.qualifyingLevelIds) || p.qualifyingLevelIds.length < 1 || p.qualifyingLevelIds.length > 50
        || !p.qualifyingLevelIds.every(id => typeof id === "string" && BOOSTY_IDENTIFIER.test(id))
        || new Set(p.qualifyingLevelIds).size !== p.qualifyingLevelIds.length) throw new Error("Invalid Boosty policy");
    if (!Number.isSafeInteger(p.minimumPrice) || (p.minimumPrice as number) < 1 || (p.minimumPrice as number) > 10_000_000) throw new Error("Invalid Boosty policy");
    if (!(BOOSTY_PRICE_FIELDS as readonly unknown[]).includes(p.priceField)) throw new Error("Invalid Boosty policy");
    if (typeof p.creatorName !== "string" || p.creatorName.trim() !== p.creatorName || p.creatorName.length < 1 || p.creatorName.length > 64 || /\p{Cc}/u.test(p.creatorName)) throw new Error("Invalid Boosty policy");
    if (typeof p.maximumDropFraction !== "number" || !(p.maximumDropFraction > 0 && p.maximumDropFraction < 1)) throw new Error("Invalid Boosty policy");
    return p as BoostyPolicy;
}
