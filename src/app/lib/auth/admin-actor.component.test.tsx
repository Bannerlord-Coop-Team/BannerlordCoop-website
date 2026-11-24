import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError, type User } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), cookies: new Map<string, string>() }));

/** Reads a fixture cookie the way the Next cookie store returns it. */
function fixtureCookie(name: string) {
    if (!mocks.cookies.has(name)) return undefined;
    return { name, value: mocks.cookies.get(name) };
}

vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: mocks.client,
}));
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: fixtureCookie }),
}));
import { getOriginalActor, loadAdminNavigationIdentity, NAVBAR_LOOKUP } from "./admin-actor";
import { IMPERSONATION_COOKIE } from "./impersonation-cookie-options";

const admin = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { role: "Admin" } } as unknown as User;

beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookies.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: admin }, error: null });
});
afterEach(() => { vi.restoreAllMocks(); });

it("resolves the original user through the actor client", async () => {
    await expect(getOriginalActor()).resolves.toBe(admin);
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ impersonation: "actor" });
});

it.each([
    ["a missing session", new AuthSessionMissingError()],
    ["a rejected token", new AuthApiError("invalid JWT", 403, "bad_jwt")],
])("reads %s as signed out so /admin can redirect to login", async (_label, error) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    await expect(getOriginalActor()).resolves.toBeNull();
});

it.each([
    ["a retryable fetch failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["a 5xx Auth error", new AuthApiError("upstream unavailable", 500, "unexpected_failure")],
    ["a rate-limited Auth request", new AuthApiError("too many requests", 429, "over_request_rate_limit")],
    ["an unknown Auth error", new AuthUnknownError("unexpected response", new Error("malformed body"))],
])("rethrows %s instead of reading it as signed out", async (_label, error) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    await expect(getOriginalActor()).rejects.toBe(error);
});

it("rethrows client and session-context failures for the caller's policy", async () => {
    const failure = new Error("backup session unavailable");
    mocks.client.mockRejectedValue(failure);
    await expect(getOriginalActor()).rejects.toBe(failure);
});

it("uses the original actor as the site viewer without an impersonation selection", async () => {
    await expect(loadAdminNavigationIdentity()).resolves.toEqual({ actor: admin, siteViewer: { user: admin } });
});

it("leaves the site viewer to the navbar while an impersonation is selected", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    await expect(loadAdminNavigationIdentity()).resolves.toEqual({ actor: admin, siteViewer: NAVBAR_LOOKUP });
    expect(console.error).not.toHaveBeenCalled();
});

it("logs a failed lookup and reads it as signed out for navigation", async () => {
    const failure = new Error("session unavailable");
    mocks.client.mockRejectedValue(failure);
    await expect(loadAdminNavigationIdentity()).resolves.toEqual({ actor: null, siteViewer: { user: null } });
    expect(console.error).toHaveBeenCalledWith("Admin navigation identity failed to load", failure);
});

it("still leaves the site viewer to the navbar when the lookup fails mid-impersonation", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    mocks.client.mockRejectedValue(new Error("backup session unavailable"));
    await expect(loadAdminNavigationIdentity()).resolves.toEqual({ actor: null, siteViewer: NAVBAR_LOOKUP });
});
