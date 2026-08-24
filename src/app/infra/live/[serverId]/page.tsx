import { LiveServerConsole } from "@/app/components/servers/LiveServerConsole";
import { hasAdminAccess } from "@/app/lib/auth/access";
import {
    getConsoleGatewayUrl,
    getLiveConsoleServer,
} from "@/app/lib/console/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import {
    ArrowLeft,
    Container,
    MapPin,
    Server,
    ShieldAlert,
    ShieldCheck,
    TerminalSquare,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type LiveServerConsolePageProps = {
    params: Promise<{ serverId: string }>;
};

export const metadata: Metadata = {
    title: "Live Server Console | Bannerlord Coop",
    description: "Admin-only Bannerlord dedicated server console.",
};

export default async function LiveServerConsolePage({ params }: LiveServerConsolePageProps) {
    const { serverId } = await params;
    const server = getLiveConsoleServer(serverId);
    if (!server) notFound();

    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
        redirect(`/login?next=${encodeURIComponent(`/infra/live/${server.id}`)}`);
    }
    if (!hasAdminAccess(user)) redirect("/infra");

    const gatewayUrl = getConsoleGatewayUrl();

    return (
        <main className="min-h-svh bg-background">
            <header className="border-b border-white/10 bg-surface">
                <div className="site-container flex min-h-18 items-center justify-between gap-4 py-3">
                    <Link
                        href="/infra"
                        className="inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" />
                        Server management
                    </Link>
                    <div className="flex items-center gap-2 text-gold">
                        <ShieldCheck aria-hidden="true" className="size-5" />
                        <span className="font-label text-xs font-semibold uppercase tracking-[0.18em]">
                            Admin console
                        </span>
                    </div>
                </div>
            </header>

            <div className="site-container py-10 sm:py-14">
                <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end" aria-labelledby="live-server-heading">
                    <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                Live dedicated server
                            </p>
                            <span className="inline-flex items-center gap-1.5 rounded-sm border border-gold/25 bg-gold/10 px-2 py-1 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-gold">
                                <TerminalSquare aria-hidden="true" className="size-3" /> Container stdin/stdout
                            </span>
                        </div>
                        <h1 id="live-server-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                            {server.name}
                        </h1>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground-muted">
                            <span className="inline-flex items-center gap-1.5">
                                <MapPin aria-hidden="true" className="size-4 text-gold-muted" />
                                <span className="font-mono text-xs">{server.address}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Server aria-hidden="true" className="size-4 text-gold-muted" /> {server.provider}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Container aria-hidden="true" className="size-4 text-gold-muted" /> Docker container
                            </span>
                        </div>
                    </div>
                </section>

                <div className="mt-8 flex gap-3 border-l-2 border-red-400 bg-red-500/[0.07] px-4 py-3.5 text-sm leading-6 text-foreground-muted">
                    <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-300" />
                    <p>
                        <strong className="font-semibold text-foreground">Admin-only production access.</strong>{" "}
                        Commands affect the live Bannerlord process immediately. The gateway revalidates the Supabase Admin role, accepts only the registered node, and ends sessions after a bounded lifetime.
                    </p>
                </div>

                <div className="mt-6">
                    <LiveServerConsole
                        gatewayUrl={gatewayUrl}
                        serverId={server.id}
                    />
                </div>
            </div>
        </main>
    );
}
