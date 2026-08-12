import { ServerControlPanel } from "@/app/components/servers/ServerControlPanel";
import {
    getMemberRole,
    hasHostedServerAccess,
} from "@/app/lib/auth/access";
import { hasServerFleetAccess } from "@/app/lib/auth/roles";
import { getServerForRole } from "@/app/lib/hosting/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import {
    ArrowLeft,
    CircleAlert,
    CloudCog,
    Crown,
    Database,
    HardDrive,
    KeyRound,
    Mail,
    MapPin,
    MemoryStick,
    Server,
    ShieldCheck,
    UserRound,
    Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

type ServerPageProps = {
    params: Promise<{ serverId: string }>;
};

export const metadata: Metadata = {
    title: "Manage Server | Bannerlord Coop",
    description: "Manage a Bannerlord Coop hosted server.",
};

export default async function ServerPage({ params }: ServerPageProps) {
    const { serverId } = await params;
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) redirect(`/login?next=/servers/${encodeURIComponent(serverId)}`);
    if (!hasHostedServerAccess(user)) redirect("/");

    const role = getMemberRole(user);
    const server = getServerForRole(serverId, role);
    if (!server) redirect("/servers");

    const isPremium = server.plan === "Premium";
    const isFleetView = hasServerFleetAccess(role);

    return (
        <main className="min-h-svh bg-background">
            <header className="border-b border-white/10 bg-surface">
                <div className="site-container flex min-h-18 items-center justify-between gap-4 py-3">
                    <Link
                        href="/servers"
                        className="inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" />
                        All servers
                    </Link>
                    <div className="flex items-center gap-2 text-gold">
                        <CloudCog aria-hidden="true" className="size-5" />
                        <span className="font-label text-xs font-semibold uppercase tracking-[0.18em]">
                            Management console
                        </span>
                    </div>
                </div>
            </header>

            <div className="site-container py-10 sm:py-14">
                <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end" aria-labelledby="server-heading">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                {server.plan} server
                            </p>
                            {isPremium && (
                                <span className="inline-flex items-center gap-1.5 rounded-sm border border-gold/25 bg-gold/[0.07] px-2 py-1 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-gold">
                                    <Crown aria-hidden="true" className="size-3" /> Priority node
                                </span>
                            )}
                        </div>
                        <h1 id="server-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                            {server.name}
                        </h1>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground-muted">
                            <span className="inline-flex items-center gap-1.5">
                                <MapPin aria-hidden="true" className="size-4 text-gold-muted" /> {server.location}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Server aria-hidden="true" className="size-4 text-gold-muted" /> {server.node}
                            </span>
                            <span className="font-mono text-xs">{server.version}</span>
                        </div>
                    </div>

                    <div className={`flex items-center gap-3 rounded-sm border px-4 py-3 ${isPremium ? "border-gold/25 bg-gold/[0.07]" : "border-white/10 bg-surface"}`}>
                        {isPremium ? (
                            <Crown aria-hidden="true" className="size-5 text-gold" />
                        ) : (
                            <ShieldCheck aria-hidden="true" className="size-5 text-foreground-muted" />
                        )}
                        <div>
                            <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">Active package</p>
                            <p className="mt-0.5 font-display text-xl font-semibold text-foreground">{server.plan}</p>
                        </div>
                    </div>
                </section>

                {isFleetView && (
                    <section className="mt-8 rounded-sm border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="account-assignment-heading">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-start gap-3">
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/10 text-gold">
                                    <UserRound aria-hidden="true" className="size-4" />
                                </span>
                                <div>
                                    <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-foreground-muted">
                                        Assigned account
                                    </p>
                                    <h2 id="account-assignment-heading" className="mt-1 font-display text-2xl font-semibold text-foreground">
                                        {server.assignedAccount.displayName}
                                    </h2>
                                </div>
                            </div>
                            <dl className="grid gap-4 sm:grid-cols-2 lg:min-w-150">
                                <div>
                                    <dt className="flex items-center gap-1.5 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">
                                        <Mail aria-hidden="true" className="size-3.5" /> Account email
                                    </dt>
                                    <dd className="mt-1 break-all text-sm text-foreground-muted">{server.assignedAccount.email}</dd>
                                </div>
                                <div>
                                    <dt className="flex items-center gap-1.5 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">
                                        <KeyRound aria-hidden="true" className="size-3.5" /> Account ID
                                    </dt>
                                    <dd className="mt-1 break-all font-mono text-xs text-foreground-muted">{server.assignedAccount.id}</dd>
                                </div>
                            </dl>
                        </div>
                    </section>
                )}

                <div className="mt-8 flex gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm text-foreground-muted">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                    <p>
                        <strong className="font-semibold text-foreground">Preview environment.</strong>{" "}
                        The VPS control plane is not connected yet. Resource readings, status changes, and logs below are safe local placeholders.
                    </p>
                </div>

                <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Server resources">
                    <ResourceCard icon={MemoryStick} label="Memory" value={server.memory} />
                    <ResourceCard icon={HardDrive} label="Storage" value={server.storage} />
                    <ResourceCard icon={Users} label="Player slots" value={`${server.maxPlayers}`} />
                    <ResourceCard icon={Database} label="Backups" value={server.backups} />
                </section>

                {isPremium && (
                    <section className="mt-4 rounded-sm border border-gold/20 bg-[linear-gradient(100deg,rgba(170,151,96,0.09),rgba(17,18,15,0.45))] px-5 py-4" aria-label="Premium server benefits">
                        <div className="flex items-start gap-3">
                            <Crown aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-gold" />
                            <div>
                                <h2 className="font-display text-xl font-semibold text-foreground">Premium management</h2>
                                <p className="mt-1 text-sm leading-6 text-foreground-muted">
                                    This preview includes a priority node, increased resources, sixteen player slots, and more frequent backup scheduling.
                                </p>
                            </div>
                        </div>
                    </section>
                )}

                <div className="mt-6">
                    <ServerControlPanel
                        initialLogs={[...server.logs]}
                        initialStatus={server.status}
                        restartSchedule={server.restartSchedule}
                        serverName={server.name}
                    />
                </div>
            </div>
        </main>
    );
}

function ResourceCard({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Server;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-sm border border-white/10 bg-surface p-4 sm:p-5">
            <div className="flex items-center gap-2 text-foreground-muted">
                <Icon aria-hidden="true" className="size-4 text-gold-muted" />
                <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em]">{label}</p>
            </div>
            <p className="mt-2 font-display text-xl font-semibold text-foreground sm:text-2xl">{value}</p>
        </div>
    );
}
