"use client";

import { useTranslations } from "@/app/lib/localization/client";
import { LoadingSpinner } from "@/app/components/ui/LoadingSpinner";
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

const buttonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-white/20 px-4 py-2 text-sm text-foreground transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-50";

/** Requires explicit localized confirmation before disconnecting the selected provider. */
export function DisconnectAccount({provider, action, disabledReason,}: {
    provider: "Discord" | "Patreon";
    action: () => Promise<void>;
    disabledReason?: string;
}) {
    const { t } = useTranslations("account");
    const [confirming, setConfirming] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();

    return (
        <div className="mt-5">
            <button ref={trigger} type="button" disabled={!!disabledReason} aria-expanded={confirming} aria-controls={id}
                    aria-describedby={disabledReason ? `${id}-reason` : undefined}
                    className={buttonClass}
                    onClick={() => setConfirming((open) => !open)}
            >
                {t("disconnect.trigger", { provider })}
            </button>

            {disabledReason && (
                <p id={`${id}-reason`} className="mt-2 text-sm leading-6 text-foreground-muted">
                    {disabledReason}
                </p>
            )}

            {confirming && (
                <form id={id} action={action} className="mt-3 rounded-sm border border-white/10 p-4">
                    <p className="text-sm leading-6 text-foreground-muted">
                        {provider === "Patreon"
                            ? t("disconnect.patreonExplanation")
                            : t("disconnect.discordExplanation")}
                    </p>

                    <ConfirmationButtons provider={provider}
                                         onCancel={() => {
                                             setConfirming(false);
                                             trigger.current?.focus();
                                         }}/>
                </form>
            )}
        </div>
    );
}

/** Presents localized submit, cancel, and live pending feedback for the disconnect form. */
function ConfirmationButtons({provider, onCancel,}: { provider: string; onCancel: () => void; }) {
    const { t } = useTranslations("account");
    const { pending } = useFormStatus();
    return (
        <div className="mt-3 flex flex-wrap gap-3">
            <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass}>
                {pending && <LoadingSpinner />}
                {pending
                    ? t("disconnect.pending", { provider })
                    : t("disconnect.confirm", { provider })}
            </button>

            <button type="button" disabled={pending} className={buttonClass} onClick={onCancel}>
                {t("disconnect.cancel")}
            </button>

            {pending && (
                <p role="status" aria-live="polite" className="sr-only">
                    {t("disconnect.pending", { provider })}
                </p>
            )}
        </div>
    );
}