import { Skeleton } from "@/app/components/ui/Skeleton";
import { getTranslations } from "@/app/lib/localization/server";

/** Announces sign-in loading in the request locale while the page streams. */
export default async function LoginLoading() {
    const { t } = await getTranslations("login");
    return (
        <main className="min-h-svh bg-background lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(30rem,0.95fr)]" aria-busy="true" aria-label={t("loading.label")}>
            <aside className="hidden min-h-svh border-r border-white/10 bg-surface lg:block" aria-hidden="true"/>

            <section className="flex min-h-svh items-center bg-surface/95 px-5 py-8 sm:px-8 lg:px-12 xl:px-20">
                <span className="sr-only" role="status">
                    {t("loading.status")}
                </span>

                <div className="mx-auto w-full max-w-lg">
                    <Skeleton className="h-3 w-36" />
                    <Skeleton className="mt-4 h-12 w-64 max-w-full" />
                    <Skeleton className="mt-4 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-4/5" />

                    <div className="mt-8 space-y-3">
                        <Skeleton className="h-13 w-full" />
                        <Skeleton className="h-13 w-full" />
                    </div>

                    <div className="my-7 flex items-center gap-4">
                        <Skeleton className="h-px flex-1" />
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-px flex-1" />
                    </div>

                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="mt-2 h-13 w-full" />
                    <Skeleton className="mt-4 h-13 w-full" />
                </div>
            </section>
        </main>
    );
}