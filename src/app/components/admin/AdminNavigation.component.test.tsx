import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { NAVBAR_LOOKUP } from "@/app/lib/auth/admin-actor";
import { resolveAdminNavigation } from "./AdminNavigation";

const admin = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { role: "Admin" }, user_metadata: {} } as unknown as User;
const member = { id: "22222222-2222-4222-8222-222222222222", app_metadata: { role: "User" }, user_metadata: {} } as unknown as User;

beforeEach(() => { vi.stubEnv("SUPABASE_ADMIN_EMAILS", ""); });

it.each([["administrator", admin, true], ["member", member, false], ["signed-out", null, false]] as const)(
    "passes the known %s site viewer to the navbar and shows the sub-navigation only to administrators",
    async (_label, actor, expectedSubNav) => {
        const { navbarViewer, showSubNav } = resolveAdminNavigation({ actor, siteViewer: { user: actor } });
        expect(showSubNav).toBe(expectedSubNav);
        expect(await navbarViewer).toEqual({ user: actor });
    },
);

it("keeps the administrator's sub-navigation while the navbar resolves the site viewer itself", () => {
    expect(resolveAdminNavigation({ actor: admin, siteViewer: NAVBAR_LOOKUP })).toEqual({ navbarViewer: undefined, showSubNav: true });
});
