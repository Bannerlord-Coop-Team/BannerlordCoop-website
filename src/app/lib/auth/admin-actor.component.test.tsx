import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

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
import { getAdminActor, hasImpersonationSelection } from "./admin-actor";
import { IMPERSONATION_COOKIE } from "./impersonation-cookie-options";

const admin = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { role: "Admin" } } as unknown as User;

beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookies.clear();
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: admin } });
});

it("resolves the original user through the actor client outside impersonation", async () => {
    await expect(getAdminActor()).resolves.toEqual({ actor: admin, impersonating: false });
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ impersonation: "actor" });
});

it("reports an impersonation selection alongside the original user", async () => {
    mocks.cookies.set(IMPERSONATION_COOKIE, "selection");
    await expect(getAdminActor()).resolves.toEqual({ actor: admin, impersonating: true });
    await expect(hasImpersonationSelection()).resolves.toBe(true);
});

it("returns a signed-out actor without inventing impersonation", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(getAdminActor()).resolves.toEqual({ actor: null, impersonating: false });
    await expect(hasImpersonationSelection()).resolves.toBe(false);
});

it("leaves the failure policy to the caller by rethrowing lookup errors", async () => {
    const failure = new Error("backup session unavailable");
    mocks.client.mockRejectedValue(failure);
    await expect(getAdminActor()).rejects.toBe(failure);
});
