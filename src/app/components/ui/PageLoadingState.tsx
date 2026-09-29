import { LoadingSpinner } from "@/app/components/ui/LoadingSpinner";

type PageLoadingStateProps = {
    label?: string;
    fullScreen?: boolean;
};

export function PageLoadingState({
    label = "Loading page…",
    fullScreen = false,
}: PageLoadingStateProps) {
    return (
        <main
            className={
                fullScreen
                    ? "flex min-h-svh items-center justify-center bg-background px-5 text-foreground"
                    : "flex min-h-96 items-center justify-center px-5 text-foreground"
            }
            aria-busy="true"
            aria-label={label}
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
                    {label}
                </p>
            </div>
        </main>
    );
}