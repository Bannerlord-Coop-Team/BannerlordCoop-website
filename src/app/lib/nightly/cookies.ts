import { DEVICE_ID_PATTERN } from "../../../../supabase/functions/_shared/nightly/formats";
import { isValidUsername, SESSION_TOKEN_PATTERN } from "./formats";

export const SPONSOR_COOKIE = "nightly_sponsor";
export const CLAIM_COOKIE = "nightly_claim";
export const CLAIM_COOKIE_SECONDS = 10 * 60;

/** Pending sponsor claim carried from the Discord callback to the claim form. */
export type ClaimContext = { deviceId: string; username: string; previousSponsorRevoked: boolean };

export type CookieOptions = {
    path: string;
    httpOnly: true;
    secure: true;
    sameSite: "lax";
    maxAge: number;
};

const MAXIMUM_CLAIM_COOKIE_LENGTH = 1024;

/** Cookie attributes shared by both nightly cookies (contract §2: Path=/nightly; HttpOnly; Secure; SameSite=Lax). */
export function nightlyCookieOptions(maxAge: number): CookieOptions {
    return { path: "/nightly", httpOnly: true, secure: true, sameSite: "lax", maxAge };
}

/** Returns the sponsor session token only when it has the contract's 43-character format. */
export function readSponsorSession(value: string | undefined): string | null {
    if (value === undefined || !SESSION_TOKEN_PATTERN.test(value)) return null;
    return value;
}

/** Encodes a claim context as base64url JSON, which is cookie-safe for any Discord username. */
export function encodeClaimContext(context: ClaimContext): string {
    const { deviceId, username, previousSponsorRevoked } = context;
    return Buffer.from(JSON.stringify({ deviceId, username, previousSponsorRevoked })).toString("base64url");
}

/** Decodes and validates a claim cookie; anything malformed reads as no pending claim. */
export function decodeClaimContext(value: string | undefined): ClaimContext | null {
    if (!value || value.length > MAXIMUM_CLAIM_COOKIE_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const { deviceId, username, previousSponsorRevoked } = parsed as Record<string, unknown>;
    if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) return null;
    if (!isValidUsername(username)) return null;
    return { deviceId, username, previousSponsorRevoked: previousSponsorRevoked === true };
}
