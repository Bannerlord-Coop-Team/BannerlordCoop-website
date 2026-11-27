import { AdminSubNav } from "@/app/components/admin/AdminSubNav";
import { Navbar } from "@/app/components/layout/Navbar";
import { NAVBAR_LOOKUP, type AdminNavigationIdentity } from "@/app/lib/auth/admin-actor";
import { hasAdminAccess } from "@/app/lib/auth/access";
import type { User } from "@supabase/supabase-js";

export type AdminNavigationState = {
    // undefined hands the lookup to Navbar so it resolves the impersonated viewer itself; it never means signed out.
    navbarViewer: Promise<{ user: User | null }> | undefined;
    showSubNav: boolean;
};

/** Decides what the admin navigation shows: the sub-nav only for administrators, and the navbar's known viewer if any. */
export function resolveAdminNavigation({ actor, siteViewer }: AdminNavigationIdentity): AdminNavigationState {
    const showSubNav = actor !== null && hasAdminAccess(actor);
    if (siteViewer === NAVBAR_LOOKUP) return { navbarViewer: undefined, showSubNav };
    return { navbarViewer: Promise.resolve(siteViewer), showSubNav };
}

/** Renders the site navbar and, when resolved for an administrator, the admin sub-navigation below it. */
export async function AdminNavigation({ identity }: { identity: Promise<AdminNavigationIdentity> }) {
    const { navbarViewer, showSubNav } = resolveAdminNavigation(await identity);

    return (
        <>
            <Navbar viewer={navbarViewer} />
            {showSubNav && <AdminSubNav />}
        </>
    );
}
