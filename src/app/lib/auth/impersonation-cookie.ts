import { createHmac, timingSafeEqual } from "node:crypto";

export const IMPERSONATION_COOKIE = "__Host-view-as-user";
export const ADMIN_COOKIE_PREFIX = "__Host-impersonation-admin";
export const IMPERSONATION_SECONDS = 30 * 60;
export const IMPERSONATION_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 400 * 24 * 60 * 60 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export type Impersonation = { id: string; actorId: string; actorSessionId: string; targetId: string; targetSessionId: string; issuedAt: number; expiresAt: number };

function signature(payload: string, secret: string) {
    if (secret.length < 20) throw new Error("Impersonation is not configured.");
    return createHmac("sha256", secret).update(`website-impersonation:v2:${payload}`).digest();
}
export function signImpersonation(value: Impersonation, secret: string) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${payload}.${signature(payload, secret).toString("base64url")}`;
}
export function verifyImpersonation(value: string, secret: string, allowExpired = false, now = Date.now()): Impersonation {
    if (value.length > 2048 || !/^[\w-]+\.[\w-]+$/u.test(value)) throw new Error("Invalid impersonation.");
    const [payload, supplied] = value.split(".");
    const expected = signature(payload, secret), actual = Buffer.from(supplied, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid impersonation.");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Impersonation;
    if (!data || Object.keys(data).sort().join() !== "actorId,actorSessionId,expiresAt,id,issuedAt,targetId,targetSessionId"
        || ![data.id, data.actorId, data.actorSessionId, data.targetId, data.targetSessionId].every(value => typeof value === "string" && UUID.test(value))
        || !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.expiresAt)
        || data.issuedAt > now || (!allowExpired && data.expiresAt <= now)
        || data.expiresAt - data.issuedAt !== IMPERSONATION_SECONDS * 1000) throw new Error("Impersonation expired or is unavailable.");
    return data;
}
export function authSessionId(accessToken: string): string {
    const value: unknown = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString());
    if (!value || typeof value !== "object" || !("session_id" in value) || typeof value.session_id !== "string" || !UUID.test(value.session_id)) throw new Error("The session is unavailable.");
    return value.session_id;
}
