"use client";

import { useTranslations } from "@/app/lib/localization/client";
import { LoadingSpinner } from "@/app/components/ui/LoadingSpinner";

type PageLoadingStateProps = {
    label?: string;
    fullScreen?: boolean;
};

/** Displays an accessible busy state with a localized default or caller-owned page label. */
export function PageLoadingState({
    label,
    fullScreen = false,
}: PageLoadingStateProps) {
    const { t } = useTranslations("common");
    const resolvedLabel = label ?? t("loading.page");
    return (
        <main
            className={
                fullScreen
                    ? "flex min-h-svh items-center justify-center bg-background px-5 text-foreground"
                    : "flex min-h-96 items-center justify-center px-5 text-foreground"
            }
            aria-busy="true"
            aria-label={resolvedLabel}
        >
            <div className="flex flex-col items-center gap-4 text-center">
                <span className="flex size-12 items-center justify-center rounded-full border border-gold/25 bg-gold/10 text-gold">
                    <LoadingSpinner className="size-6" />
                </span>
                <p
                    role="status"
                    aria-live="polite"
                    className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground-muted"
                >
                    {resolvedLabel}
                </p>
            </div>
        </main>
    );
}