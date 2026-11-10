// One-time Boosty link codes: BLC-XXXXX-XXXXX over Crockford base32 (50 random bits). Only
// the SHA-256 of the canonical upper-case code is stored; the browser shows the code once.
import { sha256 } from "./membership.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LINK_CODE = /^BLC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/u;
const LINK_CODE_IN_TEXT = /(?<![0-9A-Za-z])BLC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}(?![0-9A-Za-z])/giu;

/** Generates a fresh code from 10 uniformly random base32 symbols. */
export function generateLinkCode(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
    const symbols = Array.from(random(new Uint8Array(10)), byte => ALPHABET[byte & 31]).join("");
    return `BLC-${symbols.slice(0, 5)}-${symbols.slice(5)}`;
}

/** Hashes a canonical code for storage and lookup. */
export async function linkCodeHash(code: string): Promise<string> {
    if (!LINK_CODE.test(code)) throw new Error("Invalid link code");
    return sha256(code);
}

/** Finds exactly one distinct code in message text; none or several distinct codes are ignored. */
export function extractLinkCode(text: string): string | null {
    const found = new Set((text.match(LINK_CODE_IN_TEXT) ?? []).map(code => code.toUpperCase()));
    if (found.size !== 1) return null;
    const [code] = found;
    return LINK_CODE.test(code) ? code : null;
}
