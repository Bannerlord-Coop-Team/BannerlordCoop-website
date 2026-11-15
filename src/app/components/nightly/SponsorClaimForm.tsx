"use client";

import { LoadingButton } from "@/app/components/ui/LoadingButton";
import { useActionState } from "react";
import { alertClass, primaryButtonClass } from "./styles";

/** Result of a claim submission; a successful claim redirects, so only errors come back. */
export type ClaimFormState = { error: string | null };

export type ClaimFormAction = (state: ClaimFormState, form: FormData) => Promise<ClaimFormState>;

/** Collects a friend's sponsor code and submits it through the injected server action. */
export function SponsorClaimForm({ action }: { action: ClaimFormAction }) {
    const [state, formAction] = useActionState(action, { error: null });
    return (
        <form action={formAction} className="mt-2">
            <label htmlFor="sponsor-code" className="mb-2 block font-label text-sm font-semibold text-foreground">
                Enter your friend&rsquo;s sponsor code
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
                <input
                    id="sponsor-code"
                    name="sponsor_code"
                    required
                    maxLength={128}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX"
                    aria-describedby="sponsor-help"
                    aria-invalid={state.error !== null || undefined}
                    className="h-12 min-w-0 flex-1 rounded-sm border border-white/20 bg-background/70 px-4 font-mono text-base uppercase tracking-[0.08em] text-foreground placeholder:text-foreground-dim hover:border-gold/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                />
                <LoadingButton className={primaryButtonClass} pendingText="Claiming…">
                    Claim a seat <span aria-hidden="true">&rarr;</span>
                </LoadingButton>
            </div>
            {state.error !== null && <p role="alert" className={alertClass}>{state.error}</p>}
            <p id="sponsor-help" className="mt-3 text-xs leading-5 text-foreground-dim">
                Your friend must have a qualifying Staff, Tester, Patreon, Boosty, or Afdian role and an open seat. Access is
                checked again on every install and update.
            </p>
        </form>
    );
}
