import type { DirectoryServer } from "@/app/lib/hosting/servers";
import { ChevronRight, LogIn, Server } from "lucide-react";
import Link from "next/link";

type ServerDirectoryTableProps = {
    servers: readonly DirectoryServer[];
    showManage?: boolean;
    emptyMessage: string;
};

const connectionTypeStyles = {
    Direct: "border-sky-400/20 bg-sky-400/[0.07] text-sky-300",
    Steam: "border-indigo-400/20 bg-indigo-400/[0.07] text-indigo-300",
    GOG: "border-violet-400/20 bg-violet-400/[0.07] text-violet-300",
} as const;

export function ServerDirectoryTable({
    servers,
    showManage = false,
    emptyMessage,
}: ServerDirectoryTableProps) {
    if (servers.length === 0) {
        return (
            <div className="flex min-h-36 items-center justify-center border border-dashed border-white/15 bg-surface px-6 text-center text-sm text-foreground-muted">
                {emptyMessage}
            </div>
        );
    }

    return (
        <div className="overflow-x-auto border border-white/10 bg-surface">
            <table className="w-full min-w-170 border-collapse text-left">
                <thead className="border-b border-white/10 bg-white/[0.025]">
                    <tr>
                        <th scope="col" className="px-5 py-3.5 font-label text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-foreground-dim sm:px-6">
                            Name
                        </th>
                        <th scope="col" className="px-5 py-3.5 font-label text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-foreground-dim sm:px-6">
                            Player count
                        </th>
                        <th scope="col" className="px-5 py-3.5 font-label text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-foreground-dim sm:px-6">
                            Type
                        </th>
                        <th scope="col" className="px-5 py-3.5 text-right font-label text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-foreground-dim sm:px-6">
                            Actions
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {servers.map((server) => {
                        const isOnline = server.status === "Online";

                        return (
                            <tr key={server.id} className="group border-b border-white/10 last:border-b-0 hover:bg-white/[0.025]">
                                <td className="px-5 py-4 sm:px-6 sm:py-5">
                                    <div className="flex items-center gap-3">
                                        <span className="flex size-9 shrink-0 items-center justify-center border border-white/10 bg-background text-gold-muted">
                                            <Server aria-hidden="true" className="size-4" />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="truncate font-label text-sm font-semibold uppercase tracking-[0.07em] text-foreground transition-colors group-hover:text-gold">
                                                {server.name}
                                            </p>
                                            <p className="mt-1 flex items-center gap-1.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                                                <span aria-hidden="true" className={`size-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-foreground-dim"}`} />
                                                {server.status}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="whitespace-nowrap px-5 py-4 font-label text-sm font-semibold tabular-nums text-foreground sm:px-6 sm:py-5">
                                    {server.players}
                                </td>
                                <td className="whitespace-nowrap px-5 py-4 sm:px-6 sm:py-5">
                                    <span className={`inline-flex border px-2.5 py-1 font-label text-[0.65rem] font-semibold uppercase tracking-[0.14em] ${connectionTypeStyles[server.connectionType]}`}>
                                        {server.connectionType}
                                    </span>
                                </td>
                                <td className="px-5 py-4 sm:px-6 sm:py-5">
                                    <div className="flex items-center justify-end gap-2">
                                        {isOnline ? (
                                            <a
                                                href={server.joinUrl}
                                                className="inline-flex min-h-10 items-center justify-center gap-2 border border-crimson bg-crimson px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson"
                                            >
                                                <LogIn aria-hidden="true" className="size-3.5" />
                                                Join
                                            </a>
                                        ) : (
                                            <button
                                                type="button"
                                                disabled
                                                className="inline-flex min-h-10 cursor-not-allowed items-center justify-center gap-2 border border-white/10 bg-white/[0.03] px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground-dim"
                                            >
                                                <LogIn aria-hidden="true" className="size-3.5" />
                                                Join
                                            </button>
                                        )}
                                        {showManage && (
                                            <Link
                                                href={`/infra/${server.id}`}
                                                className="inline-flex min-h-10 items-center justify-center gap-1.5 border border-gold/35 bg-gold/[0.07] px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                                            >
                                                Manage
                                                <ChevronRight aria-hidden="true" className="size-3.5" />
                                            </Link>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
