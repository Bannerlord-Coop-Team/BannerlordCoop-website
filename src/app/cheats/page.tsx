import { CheatsDirectory, type CheatCommand } from "@/app/cheats/CheatsDirectory";
import commandsData from "@/app/cheats/commands.json";
import { parseCheatsQuery } from "@/app/cheats/query";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import {
    CircleAlert,
    Keyboard,
    Monitor,
    Server,
} from "lucide-react";
import type { Metadata } from "next";

type CheatsPageProps = {
    searchParams: Promise<{
        q?: string;
        tab?: string;
        type?: string;
        side?: string;
        cheat?: string;
    }>;
};

export const metadata: Metadata = {
    title: "Cheats | Bannerlord Coop",
    description: "Search Bannerlord Coop debug console commands and copy their usage.",
};

const publishedCommands = (commandsData.commands as CheatCommand[]).filter((command) => (
    !command.command.toLowerCase().includes("fixture")
    && !command.name.toLowerCase().includes("fixture")
));
const serverCount = publishedCommands.filter((command) => command.side === "server").length;
const clientCount = publishedCommands.filter((command) => command.side === "client").length;

export default async function CheatsPage({ searchParams }: CheatsPageProps) {
    const initialQuery = parseCheatsQuery(await searchParams);
    return (
        <>
            <Navbar />
            <main className="min-h-svh bg-background">
                <div className="site-container py-10 sm:py-14">
                    <section className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end" aria-labelledby="cheats-heading">
                        <div>
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                Debug console
                            </p>
                            <h1 id="cheats-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                                Cheats
                            </h1>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted sm:text-base">
                                Featured commands are the ones people use most. Search or open a cheat to get a link you can send to someone else.
                            </p>
                        </div>

                        <dl className="grid grid-cols-3 border border-white/10 bg-surface">
                            <DirectoryStat icon={Keyboard} label="Commands" value={publishedCommands.length} />
                            <DirectoryStat icon={Server} label="Server" value={serverCount} />
                            <DirectoryStat icon={Monitor} label="Client" value={clientCount} />
                        </dl>
                    </section>

                    <div className="mt-8 flex gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm text-foreground-muted">
                        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                        <p>
                            <strong className="font-semibold text-foreground">Open the console with Alt + `.</strong>
                        </p>
                    </div>

                    <section className="mt-12 min-w-0 overflow-x-clip" aria-labelledby="cheat-directory-heading">
                        <div className="mb-5">
                            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">
                                Command directory
                            </p>
                            <h2 id="cheat-directory-heading" className="mt-2 font-display text-3xl font-semibold text-foreground sm:text-4xl">
                                Commands
                            </h2>
                        </div>
                        <CheatsDirectory commands={publishedCommands} initialQuery={initialQuery} />
                    </section>
                </div>
            </main>
            <Footer />
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
