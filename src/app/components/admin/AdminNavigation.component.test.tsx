import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveAdminNavigation } from "./AdminNavigation";

const admin = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { role: "Admin" }, user_metadata: {} } as unknown as User;
const member = { id: "22222222-2222-4222-8222-222222222222", app_metadata: { role: "User" }, user_metadata: {} } as unknown as User;

beforeEach(() => { vi.stubEnv("SUPABASE_ADMIN_EMAILS", ""); });

it.each([["administrator", admin, true], ["member", member, false], ["signed-out", null, false]] as const)(
    "reuses the %s viewer for the navbar and shows the sub-navigation only to administrators",
    async (_label, actor, expectedSubNav) => {
        const { navbarViewer, showSubNav } = resolveAdminNavigation({ actor, impersonating: false });
        expect(showSubNav).toBe(expectedSubNav);
        expect(await navbarViewer).toEqual({ user: actor });
    },
);

it("keeps the administrator's sub-navigation while impersonating but lets the navbar resolve the impersonated user", () => {
    expect(resolveAdminNavigation({ actor: admin, impersonating: true })).toEqual({ navbarViewer: undefined, showSubNav: true });
});

it("leaves an impersonating navbar to its own lookup when the actor is unknown", () => {
    expect(resolveAdminNavigation({ actor: null, impersonating: true })).toEqual({ navbarViewer: undefined, showSubNav: false });
});
