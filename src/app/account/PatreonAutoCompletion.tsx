"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/** Submit once, after hydration, through a same-origin authenticated Server Action. */
export function PatreonAutoCompletion({ action }: { action: () => Promise<void> }) {
    const formRef = useRef<HTMLFormElement>(null);
    const submitted = useRef(false);

    useEffect(() => {
        if (submitted.current || !formRef.current) return;
        submitted.current = true;
        formRef.current.requestSubmit();
    }, []);

    return <form ref={formRef} action={action}>
        <CompletionStatus />
        <noscript>JavaScript is disabled. Use the button above to finish connecting Patreon.</noscript>
    </form>;
}

function CompletionStatus() {
    const { pending } = useFormStatus();
    return <>
        <p role="status" className="text-sm leading-6">{pending ? "Connecting Patreon…" : "Finishing your Patreon connection…"}</p>
        <button type="submit" disabled={pending} className="mt-3 inline-flex min-h-11 items-center rounded-sm border border-gold/40 px-4 py-2 text-sm text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60">
            {pending ? "Connecting…" : "Finish connecting Patreon"}
        </button>
    </>;
}
