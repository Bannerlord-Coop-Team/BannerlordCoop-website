import { Check, ChevronDown, Circle, CircleEllipsis, TriangleAlert } from "lucide-react";
import { getRoadmap, type RoadmapItem } from "@/app/lib/roadmap";

const statuses = {
    completed: { label: "Completed", icon: Check, className: "text-emerald-300", cardClassName: "border-white/5 bg-transparent text-foreground/85" },
    unstable: { label: "Unstable", icon: TriangleAlert, className: "text-amber-300", cardClassName: "border-white/10 bg-surface-raised text-foreground" },
    in_progress: { label: "In Progress", icon: CircleEllipsis, className: "text-sky-300", cardClassName: "border-sky-300/25 bg-sky-300/5 text-foreground" },
    planned: { label: "Planned", icon: Circle, className: "text-foreground-muted", cardClassName: "border-white/10 bg-surface-raised text-foreground" },
};

const statusOrder: RoadmapItem["status"][] = ["planned", "in_progress", "unstable", "completed"];

export async function Roadmap() {
    const milestones = await getRoadmap();
    if (milestones.length === 0) return null;

    return (
        <section
            id="roadmap"
            aria-labelledby="roadmap-heading"
            className="border-b border-white/10 bg-background py-16 sm:py-20 lg:py-28 2xl:py-32"
        >
            <div className="site-container">
                <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                    Development Roadmap
                </p>
                <h2
                    id="roadmap-heading"
                    className="mt-4 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-[-0.03em] text-foreground sm:text-6xl lg:text-7xl"
                >
                    The Road <span className="text-gold">Ahead</span>
                </h2>
                <p className="mt-6 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                    Explore what’s complete, what’s in development, and what’s planned for Bannerlord Coop.
                </p>

                <div className="mt-10 space-y-5 sm:mt-12">
                    {milestones.map((milestone) => {
                        const items = milestone.roadmap_items;
                        const completed = items.filter((item) => item.status === "completed").length;
                        const allCompleted = items.length > 0 && completed === items.length;
                        const populatedStatuses = statusOrder.filter((status) => items.some((item) => item.status === status));
                        const columns = {
                            1: "grid-cols-1",
                            2: "grid-cols-1 sm:grid-cols-2",
                            3: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                            4: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
                        }[populatedStatuses.length];
                        const titleParts = milestone.title.match(/^(v\d+(?:\.\d+)*)\s*-\s*(.+)$/i);

                        return (
                            <details
                                key={milestone.id}
                                open={!allCompleted}
                                className="group rounded-sm border border-white/10 bg-surface"
                            >
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold sm:p-6 [&::-webkit-details-marker]:hidden">
                                    <div className="min-w-0">
                                        <h3 className="wrap-break-word font-display text-2xl font-semibold text-foreground sm:text-3xl">
                                            {titleParts ? (
                                                <>
                                                    <span className="mb-2 block font-sans text-xs font-semibold uppercase tracking-wider text-gold">{titleParts[1]}</span>
                                                    {titleParts[2]}
                                                </>
                                            ) : milestone.title}
                                        </h3>
                                        <p className="mt-1 font-sans text-sm text-foreground-muted">
                                            {completed} of {items.length} completed
                                        </p>
                                    </div>
                                    <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-gold transition-transform group-open:rotate-180" />
                                </summary>
                                {items.length > 0 ? (
                                    <div className={`grid items-start gap-5 border-t border-white/10 p-5 sm:p-6 ${columns}`}>
                                        {populatedStatuses.map((statusKey) => {
                                            const statusItems = items.filter((item) => item.status === statusKey);
                                            const status = statuses[statusKey];
                                            const Icon = status.icon;
                                            return (
                                                <div key={statusKey} className="min-w-0">
                                                    <h4 className={`mb-3 flex items-center gap-2 font-sans text-sm font-semibold ${status.className}`}>
                                                        <Icon aria-hidden="true" className="size-4 shrink-0" />
                                                        {status.label} <span className="text-foreground-muted">&middot; {statusItems.length}</span>
                                                    </h4>
                                                    <ul
                                                        aria-label={status.label}
                                                        className={populatedStatuses.length === 1
                                                            ? "grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3"
                                                            : "flex flex-col gap-3"}
                                                    >
                                                        {statusItems.map((item) => (
                                                                <li key={item.id} className={`min-w-0 rounded-sm border px-3 py-3 ${status.cardClassName}`}>
                                                                    <h5 className="wrap-break-word font-sans text-sm font-semibold leading-6">
                                                                        {item.title}
                                                                    </h5>
                                                                    {item.description && (
                                                                        <p className="mt-2 whitespace-pre-line wrap-break-word font-sans text-sm leading-6 text-foreground-muted">
                                                                            {item.description}
                                                                        </p>
                                                                    )}
                                                                </li>
                                                        ))}
                                                    </ul>
                                                    {statusKey === "unstable" && (
                                                        <p className="mt-3 font-sans text-sm leading-5 text-foreground-muted">Implemented, but not yet reliable.</p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="border-t border-white/10 p-5 font-sans text-sm text-foreground-muted sm:p-6">
                                        No features announced yet.
                                    </p>
                                )}
                            </details>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
