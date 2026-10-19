/** Cookie settings only, without node:crypto, so the edge session middleware can share them. */
export const IMPERSONATION_COOKIE = "__Host-view-as-user";
export const ADMIN_COOKIE_PREFIX = "__Host-impersonation-admin";
export const IMPERSONATION_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 400 * 24 * 60 * 60 };
/** The administrator's own session while impersonating, kept apart from browser auth storage. */
export const ADMIN_SESSION_COOKIE_OPTIONS = { ...IMPERSONATION_OPTIONS, name: ADMIN_COOKIE_PREFIX };
