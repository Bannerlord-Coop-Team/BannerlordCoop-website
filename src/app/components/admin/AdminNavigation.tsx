import { AdminSubNav } from "@/app/components/admin/AdminSubNav";
import { Navbar } from "@/app/components/layout/Navbar";
import type { AdminNavigationViewer } from "@/app/lib/auth/admin-actor";
import { hasAdminAccess } from "@/app/lib/auth/access";
import type { User } from "@supabase/supabase-js";

export type AdminNavigationState = {
    navbarViewer: Promise<{ user: User | null }> | undefined;
    showSubNav: boolean;
};

/** Decides what the admin navigation shows: the sub-nav only for administrators, and which viewer the navbar uses. */
export function resolveAdminNavigation({ actor, impersonating }: AdminNavigationViewer): AdminNavigationState {
    const showSubNav = actor !== null && hasAdminAccess(actor);
    // While impersonating, the navbar resolves the impersonated user like every other page.
    if (impersonating) return { navbarViewer: undefined, showSubNav };
    // Otherwise the actor is the site viewer, so the navbar reuses the actor lookup.
    return { navbarViewer: Promise.resolve({ user: actor }), showSubNav };
}

/** Renders the site navbar and, when resolved for an administrator, the admin sub-navigation below it. */
export async function AdminNavigation({ viewer }: { viewer: Promise<AdminNavigationViewer> }) {
    const { navbarViewer, showSubNav } = resolveAdminNavigation(await viewer);

    return (
        <>
            <Navbar viewer={navbarViewer} />
            {showSubNav && <AdminSubNav />}
        </>
    );
}
