"use client";

import { Copy } from "lucide-react";
import { useState } from "react";

type Props = {
    address: string | null;
    disabled?: boolean;
    onCopied?: () => void;
};

export function CopyJoinButton({ address, disabled = false, onCopied }: Props) {
    const [result, setResult] = useState<{ address: string; ok: boolean } | null>(null);
    const unavailable = disabled || !address;
    const current = result?.address === address ? result : null;

    async function copy() {
        if (unavailable || !address) return;
        try {
            await navigator.clipboard.writeText(address);
        } catch {
            setResult({ address, ok: false });
            return;
        }
        setResult({ address, ok: true });
        onCopied?.();
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <button
                type="button"
                disabled={unavailable}
                onClick={copy}
                title={address ? `Copy ${address}` : "Connection address not available"}
                className="inline-flex min-h-10 items-center justify-center gap-2 border border-crimson bg-crimson px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-foreground-dim"
            >
                <Copy aria-hidden="true" className="size-3.5" />
                {current?.ok ? "Copied!" : "Join"}
            </button>
            <span role="status" className="max-w-64 text-xs text-foreground-muted">
                {current && (current.ok ? "IP and port copied." : `Could not copy. Copy manually: ${address}`)}
            </span>
        </div>
    );
}
