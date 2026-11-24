import { AdminNavigation } from "@/app/components/admin/AdminNavigation";
import { NavbarFallback } from "@/app/components/layout/NavbarFallback";
import { loadAdminNavigationIdentity } from "@/app/lib/auth/admin-actor";
import { getTranslations } from "@/app/lib/localization/server";
import { Suspense, type ReactNode } from "react";

/** Wraps every /admin page in the site navbar and, for administrators, the admin sub-navigation. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
    const identity = loadAdminNavigationIdentity();
    const { t } = await getTranslations("common");

    return (
        <>
            <Suspense fallback={<NavbarFallback label={t("nav.loading")} />}>
                <AdminNavigation identity={identity} />
            </Suspense>
            {children}
        </>
    );
}
