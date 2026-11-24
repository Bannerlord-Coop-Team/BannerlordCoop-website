import { AdminSubNav } from "@/app/components/admin/AdminSubNav";
import { Navbar } from "@/app/components/layout/Navbar";
import { hasAdminAccess } from "@/app/lib/auth/access";
import { IMPERSONATION_COOKIE } from "@/app/lib/auth/impersonation-cookie-options";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";

type AdminViewer = { actor: User | null; impersonating: boolean };

/** Resolves the original administrator, like the member page does; failures read as signed out instead of redirecting. */
async function loadAdminViewer(): Promise<AdminViewer> {
    try {
        const impersonating = Boolean((await cookies()).get(IMPERSONATION_COOKIE));
        const { data: { user } } = await (await getSupabaseServerClient({ impersonation: "actor" })).auth.getUser();
        return { actor: user, impersonating };
    } catch {
        return { actor: null, impersonating: false };
    }
}

/** Shows the site navbar for everyone and the admin sub-navigation only to administrators. */
async function AdminNavigation({ viewer }: { viewer: Promise<AdminViewer> }) {
    const { actor, impersonating } = await viewer;
    // Without impersonation the actor is the site viewer, so the navbar reuses this request;
    // while impersonating, the navbar resolves the impersonated user like every other page.
    const navbarViewer = impersonating ? undefined : Promise.resolve({ user: actor });
    const isAdmin = actor !== null && hasAdminAccess(actor);

    return (
        <>
            <Navbar viewer={navbarViewer} />
            {isAdmin && <AdminSubNav />}
        </>
    );
}

/** Wraps every /admin page in the site navbar and, for administrators, the admin sub-navigation. */
export default function AdminLayout({ children }: { children: ReactNode }) {
    const viewer = loadAdminViewer();

    return (
        <>
            <Suspense fallback={<div role="status" aria-label="Loading navigation" className="h-16 border-b border-white/10 bg-background" />}>
                <AdminNavigation viewer={viewer} />
            </Suspense>
            {children}
        </>
    );
}
