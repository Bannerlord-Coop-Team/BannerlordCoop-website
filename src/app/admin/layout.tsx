import { AdminNavigation } from "@/app/components/admin/AdminNavigation";
import { NavbarFallback } from "@/app/components/layout/NavbarFallback";
import { loadAdminNavigationViewer } from "@/app/lib/auth/admin-actor";
import { Suspense, type ReactNode } from "react";

/** Wraps every /admin page in the site navbar and, for administrators, the admin sub-navigation. */
export default function AdminLayout({ children }: { children: ReactNode }) {
    const viewer = loadAdminNavigationViewer();

    return (
        <>
            <Suspense fallback={<NavbarFallback label="Loading navigation" />}>
                <AdminNavigation viewer={viewer} />
            </Suspense>
            {children}
        </>
    );
}
