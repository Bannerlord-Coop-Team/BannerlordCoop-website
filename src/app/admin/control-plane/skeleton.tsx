export type ControlPlaneView =
    | "overview"
    | "vps"
    | "servers"
    | "server"
    | "jobs"
    | "releases"
    | "audit"
    | "operations";

const TAB_WIDTHS = ["w-24", "w-15", "w-22", "w-18", "w-24", "w-19", "w-28"];

export function ControlPlanePageSkeleton() {
    return (
        <main className="min-h-svh bg-background" aria-busy="true" aria-label="Loading control plane">
            <header className="border-b border-white/10 bg-surface">
                <div className="site-container flex min-h-18 items-center justify-between gap-4 py-3">
                    <Skeleton className="h-4 w-26" />
                    <div className="flex gap-2">
                        <Skeleton className="h-9 w-22" />
                        <Skeleton className="h-9 w-32" />
                    </div>
                </div>
            </header>
            <div className="site-container py-10 sm:py-14">
                <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
                    <div className="w-full max-w-3xl">
                        <Skeleton className="h-3 w-48" />
                        <Skeleton className="mt-4 h-12 w-72 max-w-full" />
                        <Skeleton className="mt-4 h-4 w-full" />
                        <Skeleton className="mt-2 h-4 w-4/5" />
                    </div>
                    <Skeleton className="h-4 w-24" />
                </div>
                <div className="mt-9 flex gap-2 overflow-hidden border-b border-white/10 pb-3" aria-hidden="true">
                    {TAB_WIDTHS.map((width, index) => <Skeleton key={index} className={`h-10 shrink-0 ${width}`} />)}
                </div>
                <ControlPlaneViewSkeleton view="overview" />
            </div>
        </main>
    );
}

export function ControlPlaneViewSkeleton({ view }: { view: ControlPlaneView }) {
    return (
        <section
            className="mt-8"
            aria-busy="true"
            aria-live="polite"
            aria-label={`Loading ${viewLabel(view)} data`}
        >
            <span className="sr-only">Loading {viewLabel(view)} data…</span>
            <div aria-hidden="true">
                {view === "overview" && <OverviewSkeleton />}
                {view === "server" && <ServerSkeleton />}
                {view === "operations" && <OperationsSkeleton />}
                {view === "releases" && <ReleaseSkeleton />}
                {["vps", "servers", "jobs", "audit"].includes(view) && <TableSkeleton view={view} />}
            </div>
        </section>
    );
}

function OverviewSkeleton() {
    return (
        <div className="space-y-8">
            <div className="grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="bg-surface px-5 py-4">
                        <Skeleton className="h-9 w-12" />
                        <Skeleton className="mt-2 h-3 w-24" />
                    </div>
                ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
                <PanelSkeleton />
                <PanelSkeleton />
            </div>
            <TableRowsSkeleton columns={6} rows={5} />
        </div>
    );
}

function ServerSkeleton() {
    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between border border-white/10 bg-surface p-5">
                <div className="w-64 max-w-[70%]">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="mt-3 h-9 w-full" />
                    <Skeleton className="mt-3 h-3 w-40" />
                </div>
                <Skeleton className="h-7 w-20" />
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
                <PanelSkeleton />
                <PanelSkeleton />
                <PanelSkeleton />
            </div>
            <TableRowsSkeleton columns={6} rows={4} />
        </div>
    );
}

function OperationsSkeleton() {
    return (
        <div className="space-y-12">
            {Array.from({ length: 2 }, (_, group) => (
                <div key={group}>
                    <HeadingSkeleton />
                    <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 6 }, (_, card) => (
                            <div key={card} className="border border-white/10 bg-surface p-5">
                                <Skeleton className="h-6 w-2/3" />
                                <Skeleton className="mt-4 h-3 w-full" />
                                <Skeleton className="mt-2 h-3 w-4/5" />
                                <Skeleton className="mt-6 h-10 w-full" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ReleaseSkeleton() {
    return (
        <div className="space-y-10">
            <div><HeadingSkeleton /><TableRowsSkeleton columns={4} rows={4} /></div>
            <div><HeadingSkeleton /><TableRowsSkeleton columns={4} rows={4} /></div>
        </div>
    );
}

function TableSkeleton({ view }: { view: ControlPlaneView }) {
    const columns = view === "vps" || view === "servers" ? 7 : 6;
    return (
        <div>
            {view === "servers" && <Skeleton className="mb-6 h-11 w-xl max-w-full" />}
            <HeadingSkeleton />
            <TableRowsSkeleton columns={columns} rows={7} />
        </div>
    );
}

function HeadingSkeleton() {
    return (
        <div className="flex items-end justify-between gap-4">
            <div>
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-2 h-9 w-48" />
            </div>
            <Skeleton className="h-7 w-8" />
        </div>
    );
}

function PanelSkeleton() {
    return (
        <div className="border border-white/10 bg-surface p-5">
            <Skeleton className="h-7 w-48" />
            <div className="mt-5 space-y-5">
                {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="flex justify-between gap-5 border-b border-white/10 pb-3 last:border-0">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 w-28" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function TableRowsSkeleton({ columns, rows }: { columns: number; rows: number }) {
    return (
        <div className="mt-5 overflow-hidden border border-white/10 bg-surface">
            <div className="grid gap-6 border-b border-white/10 p-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(5rem, 1fr))` }}>
                {Array.from({ length: columns }, (_, index) => <Skeleton key={index} className="h-3 w-4/5" />)}
            </div>
            {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="grid gap-6 border-b border-white/10 p-4 last:border-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(5rem, 1fr))` }}>
                    {Array.from({ length: columns }, (_, column) => <Skeleton key={column} className={`h-3 ${column === 0 ? "w-full" : "w-3/4"}`} />)}
                </div>
            ))}
        </div>
    );
}

function Skeleton({ className }: { className: string }) {
    return <div className={`motion-safe:animate-pulse bg-white/10 ${className}`} />;
}

function viewLabel(view: ControlPlaneView) {
    return view === "vps" ? "VPS" : view[0].toUpperCase() + view.slice(1);
}
