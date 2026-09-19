"use client";

import { LoadingSpinner } from "@/app/components/ui/LoadingSpinner";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type LoadingButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    children: ReactNode;
    pendingText: string;
    spinnerClassName?: string;
};

export function LoadingButton({
    children,
    pendingText,
    spinnerClassName = "size-4",
    disabled,
    type = "submit",
    ...props
}: LoadingButtonProps) {
    const { pending } = useFormStatus();
    const isDisabled = Boolean(disabled || pending);

    return (
        <button
            {...props}
            type={type}
            disabled={isDisabled}
            aria-disabled={isDisabled || undefined}
            aria-busy={pending || undefined}
        >
            {pending ? (
                <>
                    <LoadingSpinner className={spinnerClassName} />
                    <span role="status" aria-live="polite">{pendingText}</span>
                </>
            ) : (
                children
            )}
        </button>
    );
}