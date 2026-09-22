"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Reloads the server-rendered GHCR catalog without promoting or installing a release. */
export function RefreshReleaseCatalog() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}
        className="min-h-10 border border-gold/35 bg-gold/10 px-4 py-2 text-sm text-gold disabled:opacity-50">
        {pending ? "Refreshing GHCR…" : "Refresh GHCR releases"}
    </button>;
}
