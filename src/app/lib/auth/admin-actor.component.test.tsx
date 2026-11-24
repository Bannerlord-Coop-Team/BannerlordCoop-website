import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, type User } from "@supabase/supabase-js";
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
import { getAdminActor, loadAdminNavigationViewer } from "./admin-actor";
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
    await expect(getAdminActor()).resolves.toBe(admin);
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ impersonation: "actor" });
});

it.each([
    ["a missing session", new AuthSessionMissingError()],
    ["a rejected token", new AuthApiError("invalid JWT", 403, "bad_jwt")],
])("reads %s as signed out so /admin can redirect to login", async (_label, error) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    await expect(getAdminActor()).resolves.toBeNull();
});

it.each([
    ["a retryable fetch failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["a 5xx Auth error", new AuthApiError("upstream unavailable", 500, "unexpected_failure")],
])("rethrows %s instead of reading an Auth outage as signed out", async (_label, error) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    await expect(getAdminActor()).rejects.toBe(error);
});

it("rethrows client and session-context failures for the caller's policy", async () => {
    const failure = new Error("backup session unavailable");
    mocks.client.mockRejectedValue(failure);
    await expect(getAdminActor()).rejects.toBe(failure);
});

it("reports an impersonation selection alongside the original user for navigation", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    await expect(loadAdminNavigationViewer()).resolves.toEqual({ actor: admin, impersonating: true });
    expect(console.error).not.toHaveBeenCalled();
});

it("logs a failed lookup and reads it as signed out for navigation", async () => {
    const failure = new Error("session unavailable");
    mocks.client.mockRejectedValue(failure);
    await expect(loadAdminNavigationViewer()).resolves.toEqual({ actor: null, impersonating: false });
    expect(console.error).toHaveBeenCalledWith("Admin navigation viewer failed to load", failure);
});

it("keeps the impersonation state when the lookup fails mid-impersonation", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    mocks.client.mockRejectedValue(new Error("backup session unavailable"));
    await expect(loadAdminNavigationViewer()).resolves.toEqual({ actor: null, impersonating: true });
});
