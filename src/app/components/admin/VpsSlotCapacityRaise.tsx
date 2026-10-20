"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import {
    MAXIMUM_VPS_SLOT_CAPACITY,
    parseRaiseVpsSlotCapacityResult,
    slotCapacityErrorMessage,
    slotCapacityInput,
    slotCapacityRaisable,
    slotCapacityResultMessage,
} from "@/app/lib/control-plane/slot-capacity";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";

/** The audit reason the control plane requires; the form sends this fixed one. */
const RAISE_REASON = "Raised the VPS slot capacity from the admin panel; placement weighs the servers online together, which can still share its cores.";

/**
 * Raises one VPS's slot capacity from its detail panel. The control plane refuses it unless it runs with
 * HOSTING_DYNAMIC_SLOT_CAPACITY on, and checks every other fence itself.
 */
export function VpsSlotCapacityRaise({
    host,
    onRefresh,
}: {
    host: Pick<HostingAdminVpsHost, "provider" | "name" | "totalSlots" | "runnerOnboarding">;
    onRefresh?: () => void;
}) {
    const router = useRouter();
    const refresh = onRefresh ?? router.refresh;
    const inputId = useId();
    const [value, setValue] = useState(String(Math.min(host.totalSlots + 1, MAXIMUM_VPS_SLOT_CAPACITY)));
    const [submitting, setSubmitting] = useState(false);
    const [notice, setNotice] = useState<{ tone: "error" | "done"; text: string } | null>(null);
    const raisable = slotCapacityRaisable(host);

    async function raise(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const input = slotCapacityInput(value, host.totalSlots);
        if ("error" in input) {
            setNotice({ tone: "error", text: input.error });
            return;
        }
        if (!window.confirm(`Raise ${host.name} from ${host.totalSlots} to ${input.slotCapacity} slots? A capacity is never lowered. The VPS is re-commissioned for the new slots and takes no new servers until that succeeds; its current servers keep running.`)) {
            return;
        }
        setSubmitting(true);
        setNotice(null);
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const request = { provider: host.provider, serviceName: host.name, slotCapacity: input.slotCapacity };
            const result = parseRaiseVpsSlotCapacityResult(await requestControlPlaneAdmin<unknown>({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "raise-vps-slot-capacity",
                input: { ...request, reason: RAISE_REASON },
            }), request);
            if (result === null) throw new Error("The control plane returned an unexpected slot capacity result.");
            setNotice({ tone: "done", text: slotCapacityResultMessage(result) });
            refresh();
        } catch (error) {
            setNotice({ tone: "error", text: slotCapacityErrorMessage(error) });
        } finally {
            setSubmitting(false);
        }
    }

    const hint = host.totalSlots >= MAXIMUM_VPS_SLOT_CAPACITY
        ? `This VPS already holds the most slots, ${MAXIMUM_VPS_SLOT_CAPACITY}.`
        : host.runnerOnboarding?.state !== "succeeded"
            ? "Available once this VPS's runner onboarding has succeeded."
            : "A slot reserves no cores: placement plans about 1.6 vCPU for each server online together, so more online at once than that fits (about three on a 6-vCPU VPS) slow each other. Refused unless the control plane runs with HOSTING_DYNAMIC_SLOT_CAPACITY on.";
    return (
        <form onSubmit={raise} noValidate aria-label={`Raise the slot capacity of ${host.name}`} className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-white/10 px-6 py-3 text-xs">
            <div>
                <label htmlFor={inputId} className="block text-[0.6rem] uppercase tracking-[0.08em] text-foreground-dim">Slot capacity</label>
                <input
                    id={inputId}
                    type="number"
                    inputMode="numeric"
                    min={host.totalSlots + 1}
                    max={MAXIMUM_VPS_SLOT_CAPACITY}
                    step={1}
                    value={value}
                    disabled={!raisable || submitting}
                    onChange={(event) => setValue(event.target.value)}
                    className="mt-1 w-20 border border-white/15 bg-black/20 px-2 py-1.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60"
                />
            </div>
            <button
                type="submit"
                disabled={!raisable || submitting}
                title={hint}
                className="inline-flex min-h-9 items-center justify-center gap-2 border border-gold/35 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {submitting ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Plus aria-hidden="true" className="size-3.5" />}
                {submitting ? "Raising" : "Raise slots"}
            </button>
            <p className="max-w-xl text-[0.65rem] text-foreground-muted">Now {host.totalSlots} {host.totalSlots === 1 ? "slot" : "slots"}. {hint}</p>
            {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={`basis-full text-[0.65rem] ${notice.tone === "error" ? "text-red-200" : "text-emerald-300"}`}>{notice.text}</p>}
        </form>
    );
}
