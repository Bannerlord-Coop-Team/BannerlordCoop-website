"use client";

import { CircleSlash, LoaderCircle, Minus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import {
    cancelResultMessage,
    decommissionCapacityInput,
    decommissionErrorNotice,
    decommissionReasonInput,
    decommissionResultMessage,
    MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY,
    parseCancelVpsSlotDecommissionResult,
    parseDecommissionVpsSlotsResult,
    parseResolveVpsSlotDecommissionResult,
    resolveErrorNotice,
    resolveInput,
    resolveResultMessage,
    slotDecommissionAvailable,
    slotDecommissionKeptFailure,
    slotDecommissionSupported,
    type SlotDecommissionKeptFailure,
    type SlotDecommissionNotice,
} from "@/app/lib/control-plane/slot-decommission";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";

/** The audit reason of a cancel from this panel; the control plane requires one, and the form sends this fixed one. */
const CANCEL_REASON = "Cancelled the VPS slot decommission plan from the admin panel.";

type Busy = "decommission" | "cancel" | "resolve" | null;

const LABEL = "block text-[0.6rem] uppercase tracking-[0.08em] text-foreground-dim";
const FIELD = "mt-1 border border-white/15 bg-black/20 px-2 py-1.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60";
const BUTTON = "inline-flex min-h-9 items-center justify-center gap-2 border border-gold/35 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Decommissions one VPS's highest slots from its detail panel, cancels an open plan, and, when its decommission job
 * failed a kept-slot check, records the administrator's resolution. Each request carries a fresh request id, which the
 * control plane uses as its correlation id. The control plane refuses a decommission unless it runs with
 * HOSTING_DYNAMIC_SLOT_CAPACITY on, and checks every other fence itself; a control plane that cannot decommission is
 * reported as a calm note, not an alert. A VPS outside OVHcloud, where the control plane does not decommission, shows a
 * note instead of the controls.
 */
export function VpsSlotDecommission({
    host,
    onRefresh,
}: {
    host: Pick<HostingAdminVpsHost, "provider" | "name" | "totalSlots" | "runnerOnboarding">;
    onRefresh?: () => void;
}) {
    const router = useRouter();
    const refresh = onRefresh ?? router.refresh;
    const id = useId();
    const [capacity, setCapacity] = useState(String(Math.max(1, Math.min(host.totalSlots - 1, MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY))));
    const [reason, setReason] = useState("");
    const [resolution, setResolution] = useState({ accept: "", repair: "", reason: "" });
    const [busy, setBusy] = useState<Busy>(null);
    const [notice, setNotice] = useState<SlotDecommissionNotice | null>(null);
    const available = slotDecommissionAvailable(host);
    const keptFailure = slotDecommissionKeptFailure(host);
    const target = { provider: host.provider, serviceName: host.name };

    async function send(operation: string, input: Record<string, unknown>) {
        const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
        if (!session?.access_token) throw new Error("Authentication is required.");
        return await requestControlPlaneAdmin<unknown>({
            accessToken: session.access_token,
            requestId: crypto.randomUUID(),
            operation,
            input: { ...target, ...input },
        });
    }

    async function run(kind: Exclude<Busy, null>, action: () => Promise<string>, failure: (error: unknown) => SlotDecommissionNotice) {
        setBusy(kind);
        setNotice(null);
        try {
            setNotice({ tone: "done", text: await action() });
            refresh();
        } catch (error) {
            setNotice(failure(error));
        } finally {
            setBusy(null);
        }
    }

    async function decommission(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const input = decommissionCapacityInput(capacity, host.totalSlots);
        if ("error" in input) return setNotice({ tone: "error", text: input.error });
        const audit = decommissionReasonInput(reason);
        if ("error" in audit) return setNotice({ tone: "error", text: audit.error });
        const retired = host.totalSlots - input.slotCapacity === 1
            ? `Slot ${host.totalSlots} is`
            : `Slots ${input.slotCapacity + 1}–${host.totalSlots} are`;
        if (!window.confirm(`Decommission ${host.name} from ${host.totalSlots} to ${input.slotCapacity} slots? ${retired} retired once empty and torn down on the VPS. No server is moved, and new servers go only to the kept slots. While the decommission job runs the VPS takes no new servers; its current servers keep running.`)) {
            return;
        }
        await run("decommission", async () => {
            const result = parseDecommissionVpsSlotsResult(
                await send("decommission-vps-slots", { slotCapacity: input.slotCapacity, reason: audit.reason }),
                { ...target, slotCapacity: input.slotCapacity },
            );
            if (result === null) throw new Error("The control plane returned an unexpected slot decommission result.");
            return decommissionResultMessage(result, input.slotCapacity);
        }, decommissionErrorNotice);
    }

    async function cancel() {
        if (!window.confirm(`Cancel the open slot decommission plan of ${host.name}? The VPS keeps all ${host.totalSlots} slots. A decommission that already retired slots cannot be cancelled.`)) return;
        await run("cancel", async () => {
            const result = parseCancelVpsSlotDecommissionResult(await send("cancel-vps-slot-decommission", { reason: CANCEL_REASON }), target);
            if (result === null) throw new Error("The control plane returned an unexpected decommission cancel result.");
            return cancelResultMessage(result);
        }, decommissionErrorNotice);
    }

    /**
     * Resolves the failure this render shows: `failure` is the row's kept-slot failure when the form rendered, and the
     * request is bound to its onboarding time, so a page the control plane has moved past is refused, not resolved.
     */
    async function resolve(event: FormEvent<HTMLFormElement>, failure: SlotDecommissionKeptFailure) {
        event.preventDefault();
        const input = resolveInput(resolution, failure.onboardingUpdatedAt);
        if ("error" in input) return setNotice({ tone: "error", text: input.error });
        const listed = input.slots.map((slot) => `index ${slot.slotIndex} (Slot ${slot.slotIndex + 1}): ${slot.disposition}`).join("; ");
        const failed = failure.slotIndex === null ? "its kept-slot failure" : `its kept-slot failure on Slot ${failure.slotIndex + 1} (index ${failure.slotIndex})`;
        if (!window.confirm(`Resolve the kept slots of ${host.name} and requeue its decommission job? This answers ${failed}, ${failure.code}, as the runner reported it at ${failure.onboardingUpdatedAt} (UTC); if the runner state has changed since, the control plane refuses it. ${listed}. Accept takes the slot as it is now as its new baseline; repair has the job repair it first.`)) return;
        await run("resolve", async () => {
            const result = parseResolveVpsSlotDecommissionResult(await send("resolve-vps-slot-decommission-kept-slots", input), target);
            if (result === null) throw new Error("The control plane returned an unexpected kept-slot resolution result.");
            return resolveResultMessage(result);
        }, resolveErrorNotice);
    }

    const hint = host.runnerOnboarding === null
        ? "Available once this VPS has been onboarded."
        : host.totalSlots <= 1
            ? "This VPS holds one slot, the fewest a VPS keeps."
            : !available
                ? "Available once this VPS's runner onboarding is no longer running."
                : "Retires the highest slots once they hold no server; it never moves a server. Refused unless the control plane runs with HOSTING_DYNAMIC_SLOT_CAPACITY on.";
    const disabled = busy !== null;
    if (!slotDecommissionSupported(host)) {
        return <p className="border-t border-white/10 px-6 py-3 text-[0.65rem] text-foreground-muted">Slot decommissioning is not supported on this VPS: the control plane decommissions slots on OVHcloud VPSs only.</p>;
    }
    const failedSlot = keptFailure?.slotIndex ?? null;
    return (
        <div className="border-t border-white/10 px-6 py-3 text-xs">
            <form onSubmit={decommission} noValidate aria-label={`Decommission slots of ${host.name}`} className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div>
                    <label htmlFor={`${id}-capacity`} className={LABEL}>Keep slots</label>
                    <input
                        id={`${id}-capacity`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={Math.max(1, Math.min(host.totalSlots - 1, MAXIMUM_DECOMMISSIONED_SLOT_CAPACITY))}
                        step={1}
                        value={capacity}
                        disabled={!available || disabled}
                        onChange={(event) => setCapacity(event.target.value)}
                        className={`${FIELD} w-20`}
                    />
                </div>
                <div className="min-w-56 flex-1">
                    <label htmlFor={`${id}-reason`} className={LABEL}>Reason</label>
                    <input
                        id={`${id}-reason`}
                        type="text"
                        maxLength={1_000}
                        value={reason}
                        disabled={!available || disabled}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Why this VPS needs fewer slots"
                        className={`${FIELD} w-full`}
                    />
                </div>
                <button type="submit" disabled={!available || disabled} title={hint} className={BUTTON}>
                    {busy === "decommission" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Minus aria-hidden="true" className="size-3.5" />}
                    {busy === "decommission" ? "Requesting" : "Decommission slots"}
                </button>
                <button
                    type="button"
                    onClick={cancel}
                    disabled={host.runnerOnboarding === null || disabled}
                    title="Cancels this VPS's open decommission plan, if any, before it retires a slot. It answers that nothing changed when no plan is open."
                    className={BUTTON}
                >
                    {busy === "cancel" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <CircleSlash aria-hidden="true" className="size-3.5" />}
                    {busy === "cancel" ? "Cancelling" : "Cancel decommission"}
                </button>
                <p className="basis-full max-w-xl text-[0.65rem] text-foreground-muted">{hint}</p>
            </form>
            {keptFailure !== null && (
                <form onSubmit={(event) => resolve(event, keptFailure)} noValidate aria-label={`Resolve the kept slots of ${host.name}`} className="mt-3 border-t border-white/10 pt-3">
                    <p className="max-w-3xl text-[0.65rem] leading-5 text-foreground-muted">
                        {failedSlot === null
                            ? <>The decommission job&apos;s kept-slot check failed after retiring its slots: {keptFailure.description} ({keptFailure.code}).</>
                            : <>The decommission job&apos;s kept-slot check failed on <strong className="text-foreground">Slot {failedSlot + 1} (index {failedSlot})</strong> after retiring its slots: {keptFailure.description} ({keptFailure.code}).</>}
                        {" "}Accept a kept slot as it is now, or have the job repair it, and the job runs again against this VPS&apos;s open decommission. List kept slots by their zero-based index (Slot 1 is index 0). A slot that cannot be repaired stays an incident.
                        {" "}The resolution answers the runner state reported at <span className="font-mono">{keptFailure.onboardingUpdatedAt}</span> (UTC); if it has changed since this page loaded, the control plane refuses it.
                    </p>
                    <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                        <ResolveField id={`${id}-accept`} label="Accept slot indexes" className="w-32" value={resolution.accept} disabled={disabled}
                            placeholder={failedSlot === null ? "e.g. 0, 2" : `e.g. ${failedSlot}`} onChange={(accept) => setResolution({ ...resolution, accept })} />
                        <ResolveField id={`${id}-repair`} label="Repair slot indexes" className="w-32" value={resolution.repair} disabled={disabled}
                            placeholder={failedSlot === null ? "e.g. 1" : `e.g. ${failedSlot}`} onChange={(repair) => setResolution({ ...resolution, repair })} />
                        <ResolveField id={`${id}-resolve-reason`} label="Resolution reason" className="w-72 max-w-full" value={resolution.reason} disabled={disabled}
                            onChange={(value) => setResolution({ ...resolution, reason: value })} />
                        <button type="submit" disabled={disabled} className={BUTTON}>
                            {busy === "resolve" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-3.5" />}
                            {busy === "resolve" ? "Resolving" : "Resolve / accept"}
                        </button>
                    </div>
                </form>
            )}
            {notice && <p
                role={notice.tone === "error" ? "alert" : "status"}
                className={`mt-2 max-w-3xl text-[0.65rem] ${notice.tone === "error" ? "text-red-200" : notice.tone === "note" ? "border-l-2 border-white/20 px-3 py-1 text-foreground-muted" : "text-emerald-300"}`}
            >{notice.text}</p>}
        </div>
    );
}

function ResolveField({ id, label, className, value, disabled, placeholder, onChange }: {
    id: string; label: string; className: string; value: string; disabled: boolean; placeholder?: string; onChange: (value: string) => void;
}) {
    return <div>
        <label htmlFor={id} className={LABEL}>{label}</label>
        <input id={id} type="text" value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={`${FIELD} ${className}`} />
    </div>;
}
