"use client";

import { ServerDirectoryTable } from "@/app/components/servers/ServerDirectoryTable";
import type { DirectoryServer } from "@/app/lib/hosting/servers";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export function AllServersDirectory({
    servers,
}: {
    servers: readonly DirectoryServer[];
}) {
    const [search, setSearch] = useState("");
    const [hideEmpty, setHideEmpty] = useState(false);

    const filteredServers = useMemo(() => {
        const query = search.trim().toLowerCase();

        return servers.filter((server) => {
            if (hideEmpty && server.players === 0) return false;
            if (!query) return true;

            return (
                server.name.toLowerCase().includes(query) ||
                server.connectionType.toLowerCase().includes(query)
            );
        });
    }, [hideEmpty, search, servers]);

    return (
        <div>
            <div className="mb-4 flex flex-col gap-3 border border-white/10 bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-md">
                    <label htmlFor="server-search" className="sr-only">
                        Search all servers
                    </label>
                    <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-foreground-dim"
                    />
                    <input
                        id="server-search"
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search servers"
                        className="min-h-11 w-full border border-white/10 bg-background py-2 pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-dim focus:border-gold/50 focus:ring-1 focus:ring-gold/40"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch("")}
                            aria-label="Clear server search"
                            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center text-foreground-dim transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        >
                            <X aria-hidden="true" className="size-4" />
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-between gap-5 sm:justify-end">
                    <label className="inline-flex cursor-pointer items-center gap-2.5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                        <input
                            type="checkbox"
                            checked={hideEmpty}
                            onChange={(event) => setHideEmpty(event.target.checked)}
                            className="size-4 accent-crimson"
                        />
                        Hide empty
                    </label>
                    <p className="whitespace-nowrap font-label text-xs font-semibold tabular-nums text-foreground-dim" aria-live="polite">
                        {filteredServers.length} shown
                    </p>
                </div>
            </div>

            <ServerDirectoryTable
                servers={filteredServers}
                emptyMessage="No servers match your filters."
            />
        </div>
    );
}
