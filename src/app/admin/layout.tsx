import { AdminNavigation } from "@/app/components/admin/AdminNavigation";
import { NavbarFallback } from "@/app/components/layout/NavbarFallback";
import { getAdminActor, hasImpersonationSelection, type AdminActor } from "@/app/lib/auth/admin-actor";
import { Suspense, type ReactNode } from "react";

/** Loads the navigation viewer fail-soft: a failed actor lookup reads as signed out but keeps the impersonation state. */
async function loadAdminViewer(): Promise<AdminActor> {
    // Read outside the lookup, so an impersonating navbar still resolves its own viewer when the lookup fails.
    const impersonating = await hasImpersonationSelection();
    try {
        return await getAdminActor();
    } catch (error) {
        console.error("Admin navigation viewer failed to load", error);
        return { actor: null, impersonating };
    }
}

/** Wraps every /admin page in the site navbar and, for administrators, the admin sub-navigation. */
export default function AdminLayout({ children }: { children: ReactNode }) {
    const viewer = loadAdminViewer();

    return (
        <>
            <Suspense fallback={<NavbarFallback label="Loading navigation" />}>
                <AdminNavigation viewer={viewer} />
            </Suspense>
            {children}
        </>
    );
}
