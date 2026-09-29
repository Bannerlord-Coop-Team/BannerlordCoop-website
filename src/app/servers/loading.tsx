import { Navbar } from "@/app/components/layout/Navbar";
import { Skeleton } from "@/app/components/ui/Skeleton";

export default function ServersLoading() {
    return (
        <div className="min-h-svh bg-background text-foreground" aria-busy="true" aria-label="Loading servers">
            <Navbar />

            <main>
                <div className="site-container py-10 sm:py-14">
                    <span className="sr-only" role="status">
                        Loading servers…
                    </span>

                    <header>
                        <Skeleton className="h-3 w-36" />
                        <Skeleton className="mt-4 h-12 w-64 max-w-full" />
                        <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
                        <Skeleton className="mt-2 h-4 w-4/5 max-w-xl" />
                    </header>

                    <div className="mt-8 flex w-fit max-w-full overflow-hidden border border-white/10 bg-surface">
                        {Array.from({ length: 3 }, (_, index) => (
                            <div key={index}
                                className="min-w-24 border-r border-white/10 px-4 py-3 sm:min-w-32 sm:px-5"
                                aria-hidden="true">
                                <Skeleton className="h-3 w-20" />
                                <Skeleton className="mt-2 h-7 w-12" />
                            </div>
                        ))}
                    </div>

                    <ServerSectionSkeleton titleWidth="w-40" rows={3}/>

                    <ServerSectionSkeleton titleWidth="w-52" rows={6}/>
                </div>
            </main>
        </div>
    );
}

function ServerSectionSkeleton({titleWidth, rows,}: { titleWidth: string; rows: number; }) {
    return (
        <section className="mt-14" aria-hidden="true">
            <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className={`mt-3 h-9 ${titleWidth}`} />
                </div>
                <Skeleton className="h-4 w-32" />
            </div>

            <div className="overflow-hidden border border-white/10 bg-surface">
                <div className="grid grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(6rem,1fr))] gap-5 border-b border-white/10 p-4">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton
                            key={index}
                            className={index === 0 ? "h-3 w-32" : "h-3 w-20"}
                        />
                    ))}
                </div>

                {Array.from({ length: rows }, (_, row) => (
                    <div
                        key={row}
                        className="grid grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(6rem,1fr))] gap-5 border-b border-white/10 p-4"
                    >
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-9 w-24" />
                    </div>
                ))}
            </div>
        </section>
    );
}