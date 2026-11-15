import { DEVICE_ID_PATTERN } from "../../../../supabase/functions/_shared/nightly/formats";
import { DEVICE_SESSION_SECONDS } from "../../../../supabase/functions/_shared/nightly/policy";
import type { PendingClaim } from "./client";
import { isValidUsername, SESSION_TOKEN_PATTERN } from "./formats";

export const SPONSOR_COOKIE = "nightly_sponsor";
export const CLAIM_COOKIE = "nightly_claim";
/** The claim cookie lives as long as the device session it claims for. */
export const CLAIM_COOKIE_SECONDS = DEVICE_SESSION_SECONDS;

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

/** Encodes a pending claim as base64url JSON, which is cookie-safe for any Discord username. */
export function encodeClaimContext(context: PendingClaim): string {
    const { deviceId, username, previousSponsorRevoked } = context;
    return Buffer.from(JSON.stringify({ deviceId, username, previousSponsorRevoked })).toString("base64url");
}

/** Decodes and validates a claim cookie; anything malformed reads as no pending claim. */
export function decodeClaimContext(value: string | undefined): PendingClaim | null {
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
