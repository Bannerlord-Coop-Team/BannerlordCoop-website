import { LiveServerQuickControls } from "@/app/components/servers/LiveServerQuickControls";
import {
    getConsoleGatewayUrl,
    type LiveConsoleServer,
} from "@/app/lib/console/servers";
import {
    ChevronRight,
    Container,
    MapPin,
    Server,
    ShieldCheck,
    TerminalSquare,
} from "lucide-react";
import Link from "next/link";

export function LiveConsoleServersSection({
    servers,
}: {
    servers: readonly LiveConsoleServer[];
}) {
    const gatewayUrl = getConsoleGatewayUrl();

    return (
        <section
            className="mt-8 rounded-sm border border-gold/25 bg-[linear-gradient(120deg,rgba(170,151,96,0.09),rgba(17,18,15,0.82)_45%)] p-5 sm:p-6"
            aria-labelledby="live-console-servers-heading"
        >
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-sm border border-gold/30 bg-gold/10 text-gold">
                    <TerminalSquare aria-hidden="true" className="size-5" />
                </span>
                <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <h2 id="live-console-servers-heading" className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
                            Live game console
                        </h2>
                        <span className="inline-flex items-center gap-1.5 rounded-sm border border-gold/25 bg-gold/10 px-2 py-1 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-gold">
                            <ShieldCheck aria-hidden="true" className="size-3" /> Admin only
                        </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
                        Control the dedicated server container here, or open its console to stream output and send commands. This host is managed separately from IONOS.
                    </p>
                </div>
            </div>

            <div className="mt-6 grid gap-3">
                {servers.map((server) => (
                    <article key={server.id} className="rounded-sm border border-white/10 bg-background/60 p-4 sm:p-5">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <h3 className="font-display text-xl font-semibold text-foreground sm:text-2xl">
                                        {server.name}
                                    </h3>
                                    <span className="inline-flex items-center gap-1.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                                        <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
                                        Console configured
                                    </span>
                                </div>
                                <p className="mt-1 font-mono text-[0.68rem] text-foreground-dim">
                                    {server.id}
                                </p>
                            </div>

                            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:min-w-100">
                                <div>
                                    <dt className="flex items-center gap-1.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">
                                        <MapPin aria-hidden="true" className="size-3.5" /> Address
                                    </dt>
                                    <dd className="mt-1 font-mono text-xs text-foreground-muted">{server.address}</dd>
                                </div>
                                <div>
                                    <dt className="flex items-center gap-1.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">
                                        <Server aria-hidden="true" className="size-3.5" /> Provider
                                    </dt>
                                    <dd className="mt-1 text-xs text-foreground-muted">{server.provider}</dd>
                                </div>
                            </dl>

                        </div>

                        <div className="mt-5 flex flex-col gap-4 border-t border-white/10 pt-4 xl:flex-row xl:items-center">
                            <LiveServerQuickControls
                                gatewayUrl={gatewayUrl}
                                serverId={server.id}
                            />
                            <Link
                                href={`/servers/live/${encodeURIComponent(server.id)}`}
                                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-gold/10 px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:bg-gold/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                            >
                                <Container aria-hidden="true" className="size-4" />
                                Open console
                                <ChevronRight aria-hidden="true" className="size-4" />
                            </Link>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}
