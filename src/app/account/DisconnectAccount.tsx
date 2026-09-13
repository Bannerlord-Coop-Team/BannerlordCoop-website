"use client";

import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-sm border border-white/20 px-4 py-2 text-sm text-foreground transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-50";

export function DisconnectAccount({ provider, action, disabledReason }: {
    provider: "Discord" | "Patreon";
    action: () => Promise<void>;
    disabledReason?: string;
}) {
    const [confirming, setConfirming] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    return <div className="mt-5">
        <button ref={trigger} type="button" disabled={!!disabledReason} aria-expanded={confirming} aria-controls={id} aria-describedby={disabledReason ? `${id}-reason` : undefined} className={buttonClass} onClick={() => setConfirming(open => !open)}>Disconnect {provider}</button>
        {disabledReason && <p id={`${id}-reason`} className="mt-2 text-sm leading-6 text-foreground-muted">{disabledReason}</p>}
        {confirming && <form id={id} action={action} className="mt-3 rounded-sm border border-white/10 p-4">
            <p className="text-sm leading-6 text-foreground-muted">{provider === "Patreon"
                ? "Disconnecting removes membership eligibility for new servers. Existing servers and administrative grants are not removed."
                : "You will no longer be able to sign in with this Discord account. Discord-based access and new server setup may be unavailable until you reconnect. Use your other sign-in method to access this website account."}</p>
            <ConfirmationButtons provider={provider} onCancel={() => { setConfirming(false); trigger.current?.focus(); }} />
        </form>}
    </div>;
}

function ConfirmationButtons({ provider, onCancel }: { provider: string; onCancel: () => void }) {
    const { pending } = useFormStatus();
    return <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Disconnecting…" : `Confirm disconnect ${provider}`}</button>
        <button type="button" disabled={pending} className={buttonClass} onClick={onCancel}>Cancel</button>
        {pending && <p role="status" className="w-full text-sm text-foreground-muted">Disconnecting {provider}…</p>}
    </div>;
}
