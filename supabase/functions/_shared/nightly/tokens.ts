// Token and code formats for the nightly gateway. Secrets are 32 random bytes base64url-encoded
// (43 chars), codes use A-Z2-9 without look-alikes, and storage keeps only SHA-256 hex digests.
import { createHash, timingSafeEqual } from "node:crypto";

/** Supplies cryptographically random bytes; injected so tests can make tokens deterministic. */
export type RandomBytes = (count: number) => Uint8Array;

export const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const USER_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Reads random bytes from the platform Web Crypto implementation. */
export function cryptoRandomBytes(count: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(count));
}

/** Creates a 32-byte base64url secret (device code, access token, OAuth state, sponsor session). */
export function randomToken(random: RandomBytes): string {
    return base64url(random(32));
}

/** Creates `length` characters from the unambiguous code alphabet. */
export function randomCode(random: RandomBytes, length: number): string {
    return Array.from(random(length), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

/** Creates an installer user code in the `XXXX-XXXX` format. */
export function randomUserCode(random: RandomBytes): string {
    return `${randomCode(random, 4)}-${randomCode(random, 4)}`;
}

/** Creates a sponsor code in the `XXXX-XXXX-XXXX` format. */
export function randomSponsorCode(random: RandomBytes): string {
    return `${randomCode(random, 4)}-${randomCode(random, 4)}-${randomCode(random, 4)}`;
}

/** Creates an RFC 4122 version-4 UUID from the injected random source. */
export function randomUuid(random: RandomBytes): string {
    const bytes = random(16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Normalizes a typed sponsor code before hashing so case and padding do not matter. */
export function normalizeSponsorCode(value: string): string {
    return value.trim().toUpperCase();
}

/** Hex SHA-256 of a UTF-8 string, the only form in which tokens and codes are stored. */
export async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares two secrets in constant time over fixed-length digests, so neither length nor content leaks. */
export function secretsEqual(expected: string, provided: string): boolean {
    return timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(provided).digest());
}

/** Encodes bytes as unpadded base64url. */
function base64url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
