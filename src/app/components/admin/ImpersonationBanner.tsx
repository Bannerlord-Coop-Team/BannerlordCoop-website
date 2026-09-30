import { cookies } from "next/headers";
import Link from "next/link";
import { stopImpersonation } from "@/app/admin/impersonation-actions";
import { IMPERSONATION_COOKIE } from "@/app/lib/auth/impersonation-cookie";
import { resolveImpersonation } from "@/app/lib/auth/impersonation";
import { accountDisplayName } from "@/app/lib/auth/account-display";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";

export async function ImpersonationBanner() {
    const cookie = (await cookies()).get(IMPERSONATION_COOKIE);
    if (!cookie) return null;
    let label = "Impersonation expired or unavailable";
    let identity = "";
    let administrator = "";
    try {
        const { target, user } = await resolveImpersonation(await getSupabaseServerClient({ impersonation: "actor" }), cookie.value);
        label = `Viewing as ${accountDisplayName(target)}`;
        identity = target.email ?? target.id;
        administrator = accountDisplayName(user);
    } catch { /* Keep Exit available, without falling back to an administrator view. */ }
    return <aside id="impersonation-banner" aria-label="User impersonation" className="sticky top-0 z-[100] border-b border-gold/50 bg-background px-4 py-3 text-sm shadow-lg">
        <div className="site-container flex flex-wrap items-center justify-between gap-3">
            <div><p role="status" className="font-semibold text-gold">{label}{identity && <span className="ml-2 break-all font-normal">({identity})</span>}</p>
                <p className="mt-1 text-foreground-muted">Read-only · {administrator && `Admin: ${administrator} · `}Expires after 30 minutes</p><p className="text-foreground-muted">Account changes, server changes, console connections, and save/log downloads are blocked.</p></div>
            <div className="flex items-center gap-4"><Link href="/admin" prefetch={false} className="underline">Choose another user</Link>
                <form action={stopImpersonation}><button className="min-h-10 rounded-sm bg-gold px-4 font-semibold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold" type="submit">Exit impersonation</button></form></div>
        </div>
    </aside>;
}
