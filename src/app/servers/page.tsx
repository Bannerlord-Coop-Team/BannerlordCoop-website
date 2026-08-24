import { Navbar } from "@/app/components/layout/Navbar";
import { AllServersDirectory } from "@/app/components/servers/AllServersDirectory";
import {
    ServerDirectoryTable,
    type ManagedServerDirectoryEntry,
} from "@/app/components/servers/ServerDirectoryTable";
import {
    getLiveConsoleAccessLevel,
    getMemberRole,
    hasHostedServerAccess,
} from "@/app/lib/auth/access";
import { listLiveConsoleServers } from "@/app/lib/console/servers";
import { getServerDisplayNames } from "@/app/lib/hosting/server-settings";
import { getAllServers, getServersForRole } from "@/app/lib/hosting/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import {
    CircleAlert,
    Server,
    ShieldCheck,
    Users,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Servers | Bannerlord Coop",
    description: "Browse and join Bannerlord Coop servers.",
};

export default async function ServersPage() {
    let user: User | null = null;

    try {
        const supabase = await getSupabaseServerClient();
        const { data } = await supabase.auth.getUser();
        user = data.user;
    } catch {
        // Keep the public server directory available when auth is not configured.
    }

    const role = user ? getMemberRole(user) : null;
    const canManageServers = user ? hasHostedServerAccess(user) : false;
    const accessibleLiveServers = user
        ? listLiveConsoleServers().filter((server) =>
            getLiveConsoleAccessLevel(user, server.id),
        )
        : [];
    const liveServerDisplayNames = await getServerDisplayNames(
        accessibleLiveServers.map((server) => server.id),
    );
    const liveServers: ManagedServerDirectoryEntry[] = accessibleLiveServers.map(
        (server) => ({
            id: server.id,
            name: liveServerDisplayNames.get(server.id) ?? server.name,
            status: "Unknown",
            connectionType: "Direct",
            joinUrl: `bannerlordcoop://join/${server.id}`,
            players: null,
        }),
    );
    const hostedServers = role && canManageServers ? getServersForRole(role) : [];
    const managedServers: ManagedServerDirectoryEntry[] = [
        ...liveServers,
        ...hostedServers,
    ];
    const managedServerCount = managedServers.length;
    const allServers = getAllServers();
    const onlineServers = allServers.filter((server) => server.status === "Online");
    const onlinePlayers = onlineServers.reduce(
        (total, server) => total + server.players,
        0,
    );

    return (
        <>
            <Navbar />
            <main className="min-h-svh bg-background">
                <div className="site-container py-10 sm:py-14">
                <section className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end" aria-labelledby="servers-heading">
                    <div>
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                            Campaign directory
                        </p>
                        <h1 id="servers-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                            Servers
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted sm:text-base">
                            Find an active campaign, see who is playing, and join through your preferred game platform.
                        </p>
                    </div>

                    <dl className="grid grid-cols-3 border border-white/10 bg-surface">
                        <DirectoryStat icon={Server} label="Servers" value={allServers.length} />
                        <DirectoryStat icon={ShieldCheck} label="Online" value={onlineServers.length} />
                        <DirectoryStat icon={Users} label="Players" value={onlinePlayers} />
                    </dl>
                </section>

                <div className="mt-8 flex gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm text-foreground-muted">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                    <p>
                        <strong className="font-semibold text-foreground">Infrastructure preview:</strong>{" "}
                        server availability and player counts are placeholder data. Join links will open the Bannerlord Coop client when integration is available.
                    </p>
                </div>

                <section id="my-servers" className="mt-12" aria-labelledby="my-servers-heading">
                    <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                        <div>
                            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">
                                Your campaigns
                            </p>
                            <h2 id="my-servers-heading" className="mt-2 font-display text-3xl font-semibold text-foreground sm:text-4xl">
                                My Servers
                            </h2>
                        </div>
                        {user && (
                            <p className="text-sm text-foreground-muted">
                                {managedServerCount} {managedServerCount === 1 ? "server" : "servers"} available to manage
                            </p>
                        )}
                    </div>
                    {user ? (
                        <ServerDirectoryTable
                            servers={managedServers}
                            showManage
                            emptyMessage="You do not own or operate any servers yet."
                        />
                    ) : (
                        <div className="flex min-h-36 flex-col items-center justify-center gap-4 border border-dashed border-white/15 bg-surface px-6 text-center">
                            <p className="text-sm text-foreground-muted">
                                Sign in to view and manage your servers.
                            </p>
                            <Link
                                href="/login?next=/servers"
                                className="inline-flex min-h-10 items-center justify-center border border-gold/35 bg-gold/[0.07] px-5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                            >
                                Sign in
                            </Link>
                        </div>
                    )}
                </section>

                <section className="mt-14" aria-labelledby="all-servers-heading">
                    <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                        <div>
                            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">
                                Community campaigns
                            </p>
                            <h2 id="all-servers-heading" className="mt-2 font-display text-3xl font-semibold text-foreground sm:text-4xl">
                                All Servers
                            </h2>
                        </div>
                        <p className="text-sm text-foreground-muted">
                            {allServers.length} {allServers.length === 1 ? "server" : "servers"} in the directory
                        </p>
                    </div>
                    <AllServersDirectory servers={allServers} />
                </section>
                </div>
            </main>
        </>
    );
}

function DirectoryStat({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Server;
    label: string;
    value: number;
}) {
    return (
        <div className="min-w-24 border-r border-white/10 px-4 py-3 last:border-r-0 sm:min-w-32 sm:px-5">
            <dt className="flex items-center gap-1.5 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                <Icon aria-hidden="true" className="size-3.5 text-gold-muted" />
                {label}
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
                {value}
            </dd>
        </div>
    );
}
