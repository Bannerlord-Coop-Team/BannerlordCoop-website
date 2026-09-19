import { Navbar } from "@/app/components/layout/Navbar";
import { Skeleton } from "@/app/components/ui/Skeleton";

export default function ServerLoading() {
    return (
        <div className="min-h-svh bg-background text-foreground" aria-busy="true" aria-label="Loading server management">
            <Navbar />

            <main className="site-container py-8 sm:py-10">
                <span className="sr-only" role="status">
                    Loading server management…
                </span>

                <Skeleton className="h-4 w-32" />

                <div className="mt-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                    <div className="w-full max-w-3xl">
                        <Skeleton className="h-3 w-40" />
                        <Skeleton className="mt-3 h-12 w-80 max-w-full" />
                        <Skeleton className="mt-4 h-4 w-full" />
                        <Skeleton className="mt-2 h-4 w-3/4" />
                    </div>

                    <Skeleton className="h-11 w-36" />
                </div>

                <div
                    className="mt-8 flex gap-2 overflow-hidden border-b border-white/10 pb-3"
                    aria-hidden="true"
                >
                    {["w-28", "w-24", "w-24", "w-20", "w-24"].map(
                        (width, index) => (
                            <Skeleton
                                key={index}
                                className={`h-10 shrink-0 ${width}`}
                            />
                        ),
                    )}
                </div>

                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                    <section className="overflow-hidden rounded-sm border border-white/10 bg-surface">
                        <div className="border-b border-white/10 p-5">
                            <Skeleton className="h-7 w-44" />
                            <Skeleton className="mt-3 h-4 w-3/4" />
                        </div>

                        <div className="space-y-4 p-5">
                            {Array.from({ length: 7 }, (_, index) => (
                                <div key={index} className="flex items-center justify-between gap-5 border-b border-white/10 pb-4 last:pb-0">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-4 w-24" />
                                </div>
                            ))}
                        </div>
                    </section>

                    <div className="space-y-4">
                        {Array.from({ length: 3 }, (_, index) => (
                            <section key={index} className="rounded-sm border border-white/10 bg-surface p-5" aria-hidden="true">
                                <Skeleton className="h-3 w-24" />
                                <Skeleton className="mt-3 h-8 w-36" />
                                <Skeleton className="mt-5 h-10 w-full" />
                            </section>
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
}