import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveAdminNavigation } from "./AdminNavigation";

const admin = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { role: "Admin" }, user_metadata: {} } as unknown as User;
const member = { id: "22222222-2222-4222-8222-222222222222", app_metadata: { role: "User" }, user_metadata: {} } as unknown as User;

beforeEach(() => { vi.stubEnv("SUPABASE_ADMIN_EMAILS", ""); });

it("shows the sub-navigation to an administrator and reuses the actor as the navbar viewer", async () => {
    const { navbarViewer, showSubNav } = resolveAdminNavigation({ actor: admin, impersonating: false });
    expect(showSubNav).toBe(true);
    expect(await navbarViewer).toEqual({ user: admin });
});

it.each([["member", member], ["signed-out", null]])("hides the sub-navigation from a %s viewer and passes it to the navbar", async (_label, actor) => {
    const { navbarViewer, showSubNav } = resolveAdminNavigation({ actor, impersonating: false });
    expect(showSubNav).toBe(false);
    expect(await navbarViewer).toEqual({ user: actor });
});

it("keeps the administrator's sub-navigation while impersonating but lets the navbar resolve the impersonated user", () => {
    expect(resolveAdminNavigation({ actor: admin, impersonating: true })).toEqual({ navbarViewer: undefined, showSubNav: true });
});

it("leaves an impersonating navbar to its own lookup when the actor is unknown", () => {
    expect(resolveAdminNavigation({ actor: null, impersonating: true })).toEqual({ navbarViewer: undefined, showSubNav: false });
});
