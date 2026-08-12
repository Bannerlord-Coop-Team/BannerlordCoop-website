import {
    getMemberRole,
    hasHostedServerAccess,
} from "@/app/lib/auth/access";
import { hasServerFleetAccess } from "@/app/lib/auth/roles";
import { getServersForRole } from "@/app/lib/hosting/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import {
    ArrowLeft,
    ChevronRight,
    CircleAlert,
    Crown,
    MapPin,
    Server,
    ShieldCheck,
    Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Server Hosting | Bannerlord Coop",
    description: "Manage your Bannerlord Coop hosted servers.",
};

const statusStyles = {
    Online: { dot: "bg-emerald-400", text: "text-emerald-300" },
    Offline: { dot: "bg-foreground-dim", text: "text-foreground-muted" },
} as const;

export default async function ServersPage() {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) redirect("/login?next=/servers");
    if (!hasHostedServerAccess(user)) redirect("/");

    const role = getMemberRole(user);
    const isFleetView = hasServerFleetAccess(role);
    const servers = getServersForRole(role);
    const onlineCount = servers.filter((server) => server.status === "Online").length;

    return (
        <main className="min-h-svh bg-background">
            <header className="border-b border-white/10 bg-surface">
                <div className="site-container flex min-h-18 items-center justify-between gap-4 py-3">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" />
                        Back to site
                    </Link>
                    <div className="flex items-center gap-2 text-gold">
                        {isFleetView ? (
                            <ShieldCheck aria-hidden="true" className="size-5" />
                        ) : (
                            <Server aria-hidden="true" className="size-5" />
                        )}
                        <span className="font-label text-xs font-semibold uppercase tracking-[0.18em]">
                            {role}
                        </span>
                    </div>
                </div>
            </header>

            <section className="site-container py-10 sm:py-14" aria-labelledby="servers-heading">
                <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
                    <div>
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                            Hosted campaigns
                        </p>
                        <h1 id="servers-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                            {isFleetView ? "Server Fleet" : "Your Server"}
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
                            {isFleetView
                                ? "Review every hosted campaign and open its management console."
                                : "Manage your plan, runtime controls, and campaign log from one place."}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <div className="min-w-32 rounded-sm border border-white/10 bg-surface px-4 py-3">
                            <p className="font-display text-2xl font-semibold leading-none text-foreground">{servers.length}</p>
                            <p className="mt-1.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                                {servers.length === 1 ? "Server" : "Total servers"}
                            </p>
                        </div>
                        <div className="min-w-32 rounded-sm border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
                            <p className="font-display text-2xl font-semibold leading-none text-emerald-300">{onlineCount}</p>
                            <p className="mt-1.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                                Online now
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm text-foreground-muted">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                    <p>
                        <strong className="font-semibold text-foreground">Infrastructure preview:</strong>{" "}
                        server details and statuses are placeholders. Controls on the management screen only simulate VPS operations in your browser.
                    </p>
                </div>

                <div className="mt-8 grid gap-4">
                    {servers.map((server) => (
                        <article key={server.id} className="group rounded-sm border border-white/10 bg-surface p-5 transition-colors hover:border-gold/30 sm:p-6">
                            <div className="flex flex-col gap-6 xl:flex-row xl:items-center">
                                <div className="flex min-w-0 flex-1 items-start gap-4">
                                    <span className={`flex size-12 shrink-0 items-center justify-center rounded-sm border ${server.plan === "Premium" ? "border-gold/35 bg-gold/10 text-gold" : "border-white/15 bg-white/[0.035] text-foreground-muted"}`}>
                                        {server.plan === "Premium" ? (
                                            <Crown aria-hidden="true" className="size-5" />
                                        ) : (
                                            <Server aria-hidden="true" className="size-5" />
                                        )}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <h2 className="font-display text-2xl font-semibold text-foreground transition-colors group-hover:text-gold">
                                                {server.name}
                                            </h2>
                                            <span className={`inline-flex items-center gap-1.5 font-label text-[0.64rem] font-semibold uppercase tracking-[0.14em] ${statusStyles[server.status].text}`}>
                                                <span aria-hidden="true" className={`size-1.5 rounded-full ${statusStyles[server.status].dot}`} />
                                                {server.status}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-foreground-muted">{server.ownerLabel}</p>
                                    </div>
                                </div>

                                <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 xl:min-w-160">
                                    <div>
                                        <dt className="font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">Plan</dt>
                                        <dd className="mt-1 text-sm font-medium text-foreground">{server.plan}</dd>
                                    </div>
                                    <div>
                                        <dt className="font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">Region</dt>
                                        <dd className="mt-1 flex items-center gap-1.5 text-sm text-foreground-muted">
                                            <MapPin aria-hidden="true" className="size-3.5" /> {server.region}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">Players</dt>
                                        <dd className="mt-1 flex items-center gap-1.5 text-sm text-foreground-muted">
                                            <Users aria-hidden="true" className="size-3.5" /> {server.players} / {server.maxPlayers}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">Node</dt>
                                        <dd className="mt-1 font-mono text-xs text-foreground-muted">{server.node}</dd>
                                    </div>
                                </dl>

                                <Link
                                    href={`/servers/${server.id}`}
                                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson"
                                >
                                    Manage <ChevronRight aria-hidden="true" className="size-4" />
                                </Link>
                            </div>
                        </article>
                    ))}
                </div>
            </section>
        </main>
    );
}
