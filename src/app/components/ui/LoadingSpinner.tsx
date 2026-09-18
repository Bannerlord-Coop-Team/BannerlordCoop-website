import { LoaderCircle } from "lucide-react";

type LoadingSpinnerProps = {
    className?: string;
    label?: string;
};

export function LoadingSpinner({
    className = "size-4",
    label,
}: LoadingSpinnerProps) {
    const spinner = (
        <LoaderCircle
            aria-hidden="true"
            className={`shrink-0 motion-safe:animate-spin ${className}`}
        />
    );

    if (!label) return spinner;

    return (
        <span role="status" className="inline-flex items-center justify-center gap-2">
            {spinner}
            <span>{label}</span>
        </span>
    );
}