import { RefreshCw } from "lucide-react";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import { ServerRow } from "@/app/components/home/community/ServerRow";
import type { CoopServer } from "@/app/components/utils/types/server.types";

type ActiveGroupsProps = {
    servers: CoopServer[];
    lastUpdated?: string;
};

const columns = ["Server", "Region", "Mode", "Warriors", "Ping", "Status"] as const;

export function ActiveGroups({ servers, lastUpdated }: ActiveGroupsProps) {
    return (
        <ScrollReveal className="mt-16" amount={0.15}>
            <section aria-labelledby="active-servers-heading">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="font-label text-sm font-semibold uppercase tracking-[0.24em] text-gold">
                            Server Browser
                        </p>
                        <h2
                            id="active-servers-heading"
                            className="mt-4 font-display text-5xl font-semibold leading-[0.95] tracking-[-0.03em] text-foreground sm:text-6xl"
                        >
                            Online Servers
                        </h2>
                    </div>

                    {lastUpdated && (
                        <div className="flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground-dim">
                            <RefreshCw aria-hidden="true" className="size-3.5 text-gold-muted" />
                            Updated {lastUpdated}
                        </div>
                    )}
                </div>

                <div className="overflow-hidden border border-white/10 bg-surface-raised">
                    {servers.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left">
                                <thead className="border-b border-white/10 bg-background/45">
                                    <tr>
                                        {columns.map((column) => (
                                            <th
                                                key={column}
                                                scope="col"
                                                className="whitespace-nowrap px-6 py-4 font-label text-xs font-semibold uppercase tracking-[0.18em] text-foreground-dim"
                                            >
                                                {column}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {servers.map((server) => (
                                        <ServerRow key={server.id} server={server} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="px-6 py-16 text-center">
                            <p className="font-display text-2xl font-semibold text-foreground">
                                Server data not available
                            </p>
                            <p className="mt-2 text-sm text-foreground-muted">
                                Live server reporting will be available soon.
                            </p>
                        </div>
                    )}
                </div>
            </section>
        </ScrollReveal>
    );
}