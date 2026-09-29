import { Navbar } from "@/app/components/layout/Navbar";
import { Skeleton } from "@/app/components/ui/Skeleton";

export default function AccountLoading() {
    return (
        <div className="flex min-h-svh flex-col bg-background text-foreground" aria-busy="true" aria-label="Loading account">
            <Navbar />

            <main className="flex-1">
                <section className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
                    <span className="sr-only" role="status">
                        Loading account…
                    </span>

                    <Skeleton className="h-11 w-40" />

                    <div className="mt-6 flex min-w-0 items-center gap-4" aria-hidden="true">
                        <Skeleton className="size-14 shrink-0 rounded-full" />
                        <div className="min-w-0 flex-1">
                            <Skeleton className="h-8 w-52 max-w-full" />
                            <Skeleton className="mt-2 h-4 w-72 max-w-full" />
                        </div>
                    </div>

                    <div className="mt-8 overflow-hidden rounded-sm border border-white/10 bg-surface">
                        <AccountConnectionSkeleton />
                        <AccountConnectionSkeleton />
                    </div>

                    <section className="mt-8 rounded-sm border border-white/10 bg-surface p-5 sm:p-6">
                        <Skeleton className="h-8 w-36" />
                        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
                        <Skeleton className="mt-5 h-11 w-32" />
                    </section>
                </section>
            </main>
        </div>
    );
}

function AccountConnectionSkeleton() {
    return (
        <section className="border-b border-white/10 p-5 sm:p-6" aria-hidden="true">
            <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-7 w-24 rounded-full" />
            </div>

            <Skeleton className="mt-4 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-5 h-11 w-48 max-w-full" />
        </section>
    );
}