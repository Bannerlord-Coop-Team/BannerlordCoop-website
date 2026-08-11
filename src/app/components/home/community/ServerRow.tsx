import type { CoopServer } from "@/app/components/utils/types/server.types";

type ServerRowProps = {
    server: CoopServer;
};

const statusStyles = {
    Online: {
        dot: "bg-emerald-500",
        text: "text-emerald-600",
    },
    Full: {
        dot: "bg-crimson",
        text: "text-crimson",
    },
    Offline: {
        dot: "bg-foreground-dim",
        text: "text-foreground-dim",
    },
} as const;

function getPingColor(ping: number | null) {
    if (ping === null) return "text-foreground-dim";
    if (ping <= 60) return "text-emerald-400";
    if (ping <= 120) return "text-gold";
    return "text-crimson-hover";
}

export function ServerRow({ server }: ServerRowProps) {
    const status = statusStyles[server.status];

    return (
        <tr className="group border-b border-white/10 transition-colors duration-300 hover:bg-white/2.5">
            <td className="min-w-56 px-4 py-4 sm:min-w-64 sm:px-6 sm:py-5">
                <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="size-1.5 rotate-45 bg-gold-muted" />
                    <span className="font-label text-sm font-semibold uppercase tracking-[0.08em] text-foreground transition-colors duration-300 group-hover:text-gold">
                        {server.server}
                    </span>
                </div>
            </td>
            <td className="whitespace-nowrap px-4 py-4 font-sans text-sm text-foreground-muted sm:px-6 sm:py-5">
                {server.region}
            </td>
            <td className="whitespace-nowrap px-4 py-4 sm:px-6 sm:py-5">
                <span className="border border-white/10 bg-background/40 px-2.5 py-1 font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                    {server.mode}
                </span>
            </td>
            <td className="whitespace-nowrap px-4 py-4 font-label text-sm font-semibold tabular-nums text-foreground sm:px-6 sm:py-5">
                {server.warriors}{" "}
                <span className="text-foreground-dim">/ {server.maxWarriors}</span>
            </td>
            <td className={`whitespace-nowrap px-4 py-4 font-label text-sm font-semibold tabular-nums sm:px-6 sm:py-5 ${getPingColor(server.ping)}`}>
                {server.ping === null ? "—" : `${server.ping} ms`}
            </td>
            <td className="whitespace-nowrap px-4 py-4 sm:px-6 sm:py-5">
                <span className={`inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.16em] ${status.text}`}>
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${status.dot}`} />
                    {server.status}
                </span>
            </td>
        </tr>
    );
}