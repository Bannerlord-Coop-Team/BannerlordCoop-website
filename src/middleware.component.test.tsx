// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, middleware } from "./middleware";
import openNextConfig from "../open-next.config";
import { ADMIN_COOKIE_PREFIX, ADMIN_SESSION_COOKIE_OPTIONS, IMPERSONATION_COOKIE } from "./app/lib/auth/impersonation-cookie-options";

const PRIMARY = "sb-example-auth-token";
const user = { id: "44444444-4444-4444-8444-444444444444" };
const refreshes: string[] = [];
const now = () => Math.floor(Date.now() / 1000);
const encode = (value: unknown) => `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
function session(refreshToken: string, expiresIn: number, metadata = {}) {
    const expiresAt = now() + expiresIn;
    const accessToken = `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt })).toString("base64url")}.signature`;
    return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, expires_at: expiresAt, token_type: "bearer", user: { ...user, user_metadata: metadata } };
}
function request(cookies: Record<string, string>, path = "/servers/abc", method = "POST") {
    return new NextRequest(`https://bannerlordcoop.com${path}`, { method, headers: {
        cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; "),
        ...(method === "POST" ? { "next-action": "poll" } : {}),
    } });
}
/** The cookie header pages and actions receive after the middleware. */
function forwarded(response: Response) {
    // Without an override Next forwards the original request headers unchanged.
    const overridden = response.headers.get("x-middleware-override-headers");
    if (overridden === null) return null;
    return overridden.split(",").includes("cookie") ? parseCookieHeader(response.headers.get("x-middleware-request-cookie") ?? "") : [];
}
/** What a page or action reads afterwards, and whether it refreshes again. */
async function downstreamSession(cookies: { name: string; value?: string }[], cookieOptions?: typeof ADMIN_SESSION_COOKIE_OPTIONS) {
    const setAll = vi.fn();
    const client = createServerClient("https://example.supabase.co", "test-public-key", {
        ...(cookieOptions ? { cookieOptions } : {}),
        cookies: { getAll: () => cookies.map(({ name, value }) => ({ name, value: value ?? "" })), setAll },
    });
    const before = refreshes.length;
    const { data: { session } } = await client.auth.getSession();
    return { refreshToken: session?.refresh_token, refreshed: refreshes.length > before || setAll.mock.calls.length > 0 };
}

beforeEach(() => {
    refreshes.length = 0;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (url.pathname !== "/auth/v1/token" || url.searchParams.get("grant_type") !== "refresh_token") throw new Error(`Unexpected endpoint: ${url}`);
        const { refresh_token: token } = JSON.parse(String(init?.body)) as { refresh_token: string };
        refreshes.push(token);
        if (token === "revoked") return Response.json({ code: "refresh_token_not_found", message: "Invalid Refresh Token" }, { status: 400 });
        if (token === "short") return Response.json(session("short-next", 60));
        // Supabase lets a rotated token be reused for 10 s; this one has been rotated longer ago.
        if (token === "rotated" && refreshes.filter(seen => seen === token).length > 1) return Response.json({ code: "refresh_token_already_used", message: "Invalid Refresh Token: Already Used" }, { status: 400 });
        return Response.json(session(`${token}-next`, 3600, token === "grow" ? { bio: "x".repeat(4000) } : {}));
    }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("refreshes a session that the SDK would refresh later inside a server action", async () => {
    const response = await middleware(request({ [PRIMARY]: encode(session("first", 4 * 60)) }));
    expect(refreshes).toEqual(["first"]);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    // Cookies set through response.cookies would reach the action's cookie store and re-render the page.
    expect(response.headers.get("x-middleware-set-cookie")).toBeNull();
    const [setCookie] = response.headers.getSetCookie();
    expect(setCookie).toMatch(new RegExp(`^${PRIMARY}=base64-`));
    expect(setCookie).toMatch(/Path=\//u);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const cookies = forwarded(response)!;
    expect(cookies.find(({ name }) => name === PRIMARY)?.value).toBe(setCookie.split(";")[0].slice(PRIMARY.length + 1));
    expect(await downstreamSession(cookies)).toEqual({ refreshToken: "first-next", refreshed: false });
});

it("refreshes an expiring session once", async () => {
    const response = await middleware(request({ [PRIMARY]: encode(session("expiring", 30)) }));
    expect(refreshes).toEqual(["expiring"]);
    expect(await downstreamSession(forwarded(response)!)).toEqual({ refreshToken: "expiring-next", refreshed: false });
    // A token lifetime shorter than the margin still costs one refresh per request, not a chain.
    await middleware(request({ [PRIMARY]: encode(session("short", 30)) }));
    expect(refreshes).toEqual(["expiring", "short"]);
});

it("leaves fresh sessions, signed-out visitors and route handlers untouched", async () => {
    for (const response of [
        await middleware(request({ [PRIMARY]: encode(session("fresh", 30 * 60)) })),
        await middleware(request({ theme: "dark" }, "/", "GET")),
        await middleware(request({ [PRIMARY]: encode(session("callback", 30)) }, "/auth/callback", "GET")),
        await middleware(request({ [PRIMARY]: encode(session("discord", 30)) }, "/account/discord/callback", "GET")),
        await middleware(request({ [PRIMARY]: encode(session("patreon", 30)) }, "/account/patreon/callback", "GET")),
        // The console stream refreshes for itself and keeps its no-transform header.
        await middleware(request({ [PRIMARY]: encode(session("console", 30)) }, "/api/servers/abc/console", "GET")),
    ]) {
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(forwarded(response)).toBeNull();
    }
    expect(refreshes).toEqual([]);
});

it("replaces a chunked session and forwards no stale chunk", async () => {
    const large = encode(session("chunked", 60, { bio: "x".repeat(4000) }));
    const response = await middleware(request({ [`${PRIMARY}.0`]: large.slice(0, 3000), [`${PRIMARY}.1`]: large.slice(3000) }, "/servers/abc", "GET"));
    expect(refreshes).toEqual(["chunked"]);
    const cookies = forwarded(response)!;
    expect(cookies.map(({ name }) => name)).toEqual([PRIMARY]);
    const cleared = response.headers.getSetCookie().filter(cookie => /Max-Age=0/u.test(cookie)).map(cookie => cookie.split("=")[0]);
    expect(cleared.sort()).toEqual([`${PRIMARY}.0`, `${PRIMARY}.1`]);
    expect(await downstreamSession(cookies)).toEqual({ refreshToken: "chunked-next", refreshed: false });
});

it("grows a session into chunks and forwards only the new chunks", async () => {
    const response = await middleware(request({ [PRIMARY]: encode(session("grow", 60)) }, "/servers/abc", "GET"));
    expect(refreshes).toEqual(["grow"]);
    const cookies = forwarded(response)!;
    expect(cookies.map(({ name }) => name).sort()).toEqual([`${PRIMARY}.0`, `${PRIMARY}.1`]);
    const cleared = response.headers.getSetCookie().filter(cookie => /Max-Age=0/u.test(cookie)).map(cookie => cookie.split("=")[0]);
    expect(cleared).toEqual([PRIMARY]);
    expect(await downstreamSession(cookies)).toEqual({ refreshToken: "grow-next", refreshed: false });
});

it("refreshes the administrator's saved session while impersonating, with its HttpOnly options", async () => {
    const response = await middleware(request({
        [IMPERSONATION_COOKIE]: "signed-selection",
        [PRIMARY]: encode(session("member", 2 * 60)),
        [ADMIN_COOKIE_PREFIX]: encode(session("administrator", 4 * 60)),
    }));
    expect(refreshes.sort()).toEqual(["administrator", "member"]);
    const admin = response.headers.getSetCookie().find(cookie => cookie.startsWith(`${ADMIN_COOKIE_PREFIX}=`));
    for (const attribute of [/HttpOnly/u, /Secure/u, /SameSite=Lax/u, /Path=\//u, /Max-Age=34560000/u]) expect(admin).toMatch(attribute);
    expect(admin).not.toMatch(/Domain=/u);
    const cookies = forwarded(response)!;
    expect(cookies.find(({ name }) => name === IMPERSONATION_COOKIE)?.value).toBe("signed-selection");
    expect(await downstreamSession(cookies)).toEqual({ refreshToken: "member-next", refreshed: false });
    expect(await downstreamSession(cookies, ADMIN_SESSION_COOKIE_OPTIONS)).toEqual({ refreshToken: "administrator-next", refreshed: false });
});

it("still refreshes the administrator's session after the member session is gone", async () => {
    const response = await middleware(request({ [IMPERSONATION_COOKIE]: "signed-selection", [ADMIN_COOKIE_PREFIX]: encode(session("administrator", 60)) }));
    expect(refreshes).toEqual(["administrator"]);
    expect(await downstreamSession(forwarded(response)!, ADMIN_SESSION_COOKIE_OPTIONS)).toEqual({ refreshToken: "administrator-next", refreshed: false });
});

it("never lets a request that lost a rotation race clear the winner's session", async () => {
    // Refreshing minutes before expiry means a losing request still holds a valid access token.
    const stale = encode(session("rotated", 4 * 60));
    const [winner, loser] = await Promise.all([middleware(request({ [PRIMARY]: stale })), middleware(request({ [PRIMARY]: stale }))]);
    expect(refreshes).toEqual(["rotated", "rotated"]);
    expect(winner.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${PRIMARY}=base64-`, "u"))]);
    expect(loser.headers.getSetCookie()).toEqual([]);
    expect(forwarded(loser)).toBeNull();
});

it("handles a revoked refresh token as the SDK would downstream", async () => {
    // A still-valid access token keeps the session until it expires.
    const kept = await middleware(request({ [PRIMARY]: encode(session("revoked", 30)) }));
    expect(kept.headers.getSetCookie()).toEqual([]);
    expect(forwarded(kept)).toBeNull();
    // An expired one has nothing left, so the session is cleared everywhere.
    const cleared = await middleware(request({ [PRIMARY]: encode(session("revoked", -30)) }));
    expect(refreshes).toEqual(["revoked", "revoked"]);
    expect(cleared.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${PRIMARY}=;.*Max-Age=0`, "u"))]);
    expect(forwarded(cleared)).toEqual([]);
});

it("lets a server action's cookies follow the middleware's, so sign-out and impersonation changes win", () => {
    const priority = openNextConfig.dangerous?.headersAndCookiesPriority;
    const event = (method: string) => ({ method }) as Parameters<NonNullable<typeof priority>>[0];
    expect(priority?.(event("POST"))).toBe("handler");
    expect(priority?.(event("GET"))).toBe("middleware");
    expect(priority?.(event("HEAD"))).toBe("middleware");
});

it("runs for pages and actions but not for static files", () => {
    for (const url of ["/", "/servers/abc", "/account"]) expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    for (const url of ["/_next/static/chunks/app.js", "/_next/image?url=x", "/favicon.ico", "/images/logo.png", "/fonts/body.woff2", "/robots.txt"]) expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
});
