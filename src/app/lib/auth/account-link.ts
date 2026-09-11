export const LINK_COOKIE = "__Host-account-link";
export const LINK_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
export function accountReturn(value: unknown): "/servers" | "/account" { return value === "/servers" ? "/servers" : "/account"; }
export function accountLinkOrigin(value: string | undefined) {
    if (!value) throw new Error("Account linking is not configured");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.port || url.username || url.password) throw new Error("Invalid account link origin");
    return url.origin;
}
