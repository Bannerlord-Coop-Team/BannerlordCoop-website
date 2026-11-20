"use client";

import { NightlyErrorText } from "./NightlySupport";
import { LoadingButton } from "@/app/components/ui/LoadingButton";
import type { CreateCodeState, RemoveSeatState } from "@/app/lib/nightly/flows";
import { SEAT_USER_FIELD } from "@/app/lib/nightly/form-fields";
import { useActionState } from "react";
import { SPONSORED_ACCOUNT_LIMIT } from "../../../../supabase/functions/_shared/nightly/policy";
import { alertClass, primaryButtonClass, textButtonClass } from "./styles";

export type CreateCodeAction = (state: CreateCodeState, form: FormData) => Promise<CreateCodeState>;

export type RemoveSeatAction = (state: RemoveSeatState, form: FormData) => Promise<RemoveSeatState>;

/** Rotates the sponsor code through the injected action and shows the new code exactly once. */
export function CreateSponsorCodeForm({ action, hasSeats }: { action: CreateCodeAction; hasSeats: boolean }) {
    const [state, formAction] = useActionState(action, { code: null, error: null });
    return (
        <div className="mt-8">
            <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <LoadingButton className={primaryButtonClass} pendingText="Creating…">
                    {hasSeats ? "Create a new code" : "Create sponsor code"} <span aria-hidden="true">&rarr;</span>
                </LoadingButton>
                <p className="max-w-md text-xs leading-5 text-foreground-dim">
                    Creating a new code disables the previous one. Existing sponsored accounts keep access.
                </p>
            </form>
            {state.error !== null && <p role="alert" className={alertClass}><NightlyErrorText message={state.error} /></p>}
            {state.code !== null && (
                <div role="status" className="mt-6 border border-gold/25 bg-background/70 px-5 py-5">
                    <p className="font-display text-2xl font-semibold text-foreground">Sponsor code created</p>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-muted">
                        Send this code only to friends you want to sponsor. It can add accounts until your {SPONSORED_ACCOUNT_LIMIT} seats are full.
                    </p>
                    <span className="mt-4 block font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold">Your sponsor code</span>
                    <p className="mt-2 break-all font-mono text-2xl font-semibold tracking-[0.1em] text-foreground sm:text-3xl">{state.code}</p>
                    <p className="mt-3 text-xs leading-5 text-foreground-dim">This code is shown only once. Copy it before leaving the page.</p>
                </div>
            )}
        </div>
    );
}

/** Removes one sponsored Discord account through the injected action. */
export function RemoveSeatForm({ action, discordUserId }: { action: RemoveSeatAction; discordUserId: string }) {
    const [state, formAction] = useActionState(action, { error: null });
    return (
        <form action={formAction} className="flex flex-col items-start gap-1 sm:items-end">
            <input type="hidden" name={SEAT_USER_FIELD} value={discordUserId} />
            <LoadingButton className={textButtonClass} pendingText="Removing…" aria-label={`Remove access for Discord account ${discordUserId}`}>
                Remove access
            </LoadingButton>
            {state.error !== null && <p role="alert" className="max-w-xs text-xs leading-5 text-[#cf555c]"><NightlyErrorText message={state.error} /></p>}
        </form>
    );
}
