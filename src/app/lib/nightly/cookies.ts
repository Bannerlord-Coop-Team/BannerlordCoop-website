import { SESSION_TOKEN_PATTERN } from "./client";

export const SPONSOR_COOKIE = "nightly_sponsor";
export const CLAIM_COOKIE = "nightly_claim";
export const CLAIM_COOKIE_SECONDS = 10 * 60;
export const SPONSOR_SESSION_SECONDS = 24 * 60 * 60;

/** Pending sponsor claim carried from the Discord callback to the claim form. */
export type ClaimContext = { deviceId: string; username: string; previousSponsorRevoked: boolean };

export type CookieOptions = {
    path: string;
    httpOnly: true;
    secure: true;
    sameSite: "lax";
    maxAge: number;
};

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const MAXIMUM_CLAIM_COOKIE_LENGTH = 1024;

/** Cookie attributes shared by both nightly cookies (contract §2: Path=/nightly; HttpOnly; Secure; SameSite=Lax). */
export function nightlyCookieOptions(maxAge: number): CookieOptions {
    return { path: "/nightly", httpOnly: true, secure: true, sameSite: "lax", maxAge };
}

/** Serializes a nightly cookie for a raw `Set-Cookie` header. */
export function serializeNightlyCookie(name: string, value: string, maxAge: number): string {
    return `${name}=${value}; Path=/nightly; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Returns the sponsor session token only when it has the contract's 43-character format. */
export function readSponsorSession(value: string | undefined): string | null {
    if (value === undefined || !SESSION_TOKEN_PATTERN.test(value)) return null;
    return value;
}

/** Encodes a claim context as base64url JSON, which is cookie-safe for any Discord username. */
export function encodeClaimContext(context: ClaimContext): string {
    const json = JSON.stringify({ d: context.deviceId, u: context.username, r: context.previousSponsorRevoked });
    const binary = Array.from(new TextEncoder().encode(json), (byte) => String.fromCharCode(byte)).join("");
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Decodes and validates a claim cookie; anything malformed reads as no pending claim. */
export function decodeClaimContext(value: string | undefined): ClaimContext | null {
    if (!value || value.length > MAXIMUM_CLAIM_COOKIE_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
    let parsed: unknown;
    try {
        const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
        parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const { d, u, r } = parsed as Record<string, unknown>;
    if (typeof d !== "string" || !DEVICE_ID_PATTERN.test(d)) return null;
    if (typeof u !== "string" || u.length === 0 || u.length > 100) return null;
    return { deviceId: d, username: u, previousSponsorRevoked: r === true };
}
