// Clock, hashing, encoding, and bearer-token helpers shared by the pin and download-authorization modules.

const BEARER_TOKEN = /^[A-Za-z0-9_-]{43}$/;

// Returns the current Unix time in whole seconds.
export function nowSeconds(): number { return Math.floor(Date.now() / 1000); }

// Returns a random base64url token of the given byte length.
export function randomToken(bytes: number): string { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }

// Tells whether a value has the shape of a gateway bearer token: 32 bytes as unpadded base64url.
// Pin tokens and pin or nightly download-session tokens all share this shape.
export function isBearerToken(value: unknown): value is string {
    return typeof value === "string" && BEARER_TOKEN.test(value);
}

// Hashes a UTF-8 string to lowercase hex SHA-256.
export async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Hashes raw bytes to lowercase hex SHA-256.
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Encodes bytes as unpadded base64url.
export function base64url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Copies bytes into an ArrayBuffer of exactly their length for WebCrypto.
export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
