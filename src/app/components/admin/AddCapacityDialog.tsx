"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ControlPlaneActionCard, type AdminActionField, type AdminActionOption } from "./ControlPlaneActionCard";
import { ManualVpsOnboardingCard } from "./ManualVpsOnboardingCard";
import { operationExplanation } from "@/app/lib/control-plane/explanations";
import { MANUAL_VPS_OPERATION, type ManualEntryProvider } from "@/app/lib/control-plane/manual-vps";
import { vpsHostSelectionValue } from "@/app/lib/control-plane/vps-providers";
import type { HostingAdminVpsAvailableHost } from "@/app/lib/control-plane/types";
import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

/** The dialog's two onboarding sources: a provider account's inventory, or facts typed in by hand. */
export type AddCapacityTab = "provider" | "manual";

/** The provider-account inventory the Provider account tab offers: its hosts once loaded (null before), and why reads failed. */
export type ProviderAccountInventory = {
    availableHosts: readonly HostingAdminVpsAvailableHost[] | null;
    pending: boolean;
    error: string | null;
    failedProviderReads: string | null;
};

const TABS: ReadonlyArray<{ tab: AddCapacityTab; label: string }> = [
    { tab: "provider", label: "Provider account" },
    { tab: "manual", label: "Manual entry" },
];

const PROVIDER_ACCOUNT_OPERATION = "onboard-vps-host";
const PROVIDER_ACCOUNT_DESCRIPTION = "For OVHcloud and Contabo, whose account APIs list purchased VPSes. Choose one already-purchased VPS, then click Onboard VPS. The control plane revalidates it against its provider account (identity, location, vCPU capacity, and primary IPv4); acquires and pins its Ed25519 host identity; uses the preinstalled fleet-operator key; installs and hardens every managed runner slot; establishes private mTLS routes; and publishes capacity only after health checks. It never buys, renews, or cancels a VPS.";
const PROVIDER_ACCOUNT_HOST_HELP = "Only unregistered VPS products discovered in the authenticated provider accounts are shown, each with its provider. Select the saved bannerlord-fleet-operator key when installing the VPS; no SSH key, IP address, vCPU count, region, or audit reason is entered here. For a provider without an account API, use the Manual entry tab.";

/** The VPS view's "Add capacity" pop-up, holding the provider-account and manual-entry onboarding forms as two tabs. */
export function AddCapacityDialog({ initialTab, providerAccount, manualProviders, regions, regionsError, onClose, returnFocusTo }: {
    initialTab: AddCapacityTab;
    providerAccount: ProviderAccountInventory;
    manualProviders: ManualEntryProvider[];
    regions: HostingRegionPayload[] | null;
    // Why the catalog could not be read; shown on the Manual entry tab when `regions` is null.
    regionsError: string | null;
    onClose: () => void;
    // The control that opened the dialog, focused again when it closes.
    returnFocusTo?: RefObject<HTMLElement | null>;
}) {
    const id = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [tab, setTab] = useState<AddCapacityTab>(initialTab);
    const tabId = (value: AddCapacityTab) => `${id}-tab-${value}`;
    const panelId = (value: AddCapacityTab) => `${id}-panel-${value}`;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog === null) return;
        // The opener is recorded before the dialog mounts, so it is read once here and refocused on close.
        const opener = returnFocusTo?.current ?? null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        if (!dialog.open) dialog.showModal();
        dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
        return () => {
            if (dialog.open) dialog.close();
            document.body.style.overflow = previousOverflow;
            opener?.focus();
        };
    }, [returnFocusTo]);

    /** Moves the selection and focus between tabs with the arrow, Home and End keys. */
    function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
        const next = adjacentTab(event.key, tab);
        if (next === null) return;
        event.preventDefault();
        setTab(next);
        document.getElementById(tabId(next))?.focus();
    }

    return (
        <dialog
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            onCancel={(event) => { event.preventDefault(); onClose(); }}
            className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto border border-gold/30 bg-surface-raised p-0 text-foreground shadow-2xl backdrop:bg-black/70 sm:max-h-[calc(100dvh-3rem)]"
        >
            <div className="border-t-2 border-gold p-4 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">VPS inventory</p>
                        <h2 id={`${id}-title`} className="mt-2 font-display text-3xl font-semibold">Add capacity</h2>
                    </div>
                    <button type="button" aria-label="Close" onClick={onClose} className="flex size-10 shrink-0 items-center justify-center border border-white/15 text-foreground-muted transition-colors hover:border-gold/50 hover:text-gold focus-visible:outline-2 focus-visible:outline-gold">
                        <X aria-hidden="true" className="size-5" />
                    </button>
                </div>
                <p id={`${id}-description`} className="mt-3 text-xs leading-5 text-foreground-muted">Onboard an already-purchased VPS, from a provider account (OVHcloud, Contabo) or by manual entry for a provider without an account API. The durable workflow verifies the host, installs the reviewed runner, prepares every isolated slot, establishes private mTLS routes, and exposes capacity only after health proof.</p>
                <div role="tablist" aria-label="Onboarding source" className="mt-5 flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
                    {TABS.map(({ tab: value, label }) => (
                        <button key={value} type="button" role="tab" id={tabId(value)} aria-selected={tab === value} aria-controls={panelId(value)}
                            tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={moveTab}
                            className={`inline-flex min-h-10 shrink-0 items-center border px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-gold ${tab === value ? "border-gold/40 bg-gold/10 text-gold" : "border-white/10 text-foreground-muted hover:border-white/25 hover:text-foreground"}`}>
                            {label}
                        </button>
                    ))}
                </div>
                {/* Both panels stay mounted so a half-typed form or a submission result survives switching tabs. */}
                <div role="tabpanel" id={panelId("provider")} aria-labelledby={tabId("provider")} hidden={tab !== "provider"} className="mt-4">
                    <ProviderAccountPanel inventory={providerAccount} />
                </div>
                <div role="tabpanel" id={panelId("manual")} aria-labelledby={tabId("manual")} hidden={tab !== "manual"} className="mt-4">
                    <ManualVpsOnboardingCard providers={manualProviders} regions={regions} regionsError={regionsError} help={operationExplanation(MANUAL_VPS_OPERATION)} />
                </div>
            </div>
        </dialog>
    );
}

/** The tab a navigation key selects from the current one, or null when the key does not navigate. */
export function adjacentTab(key: string, current: AddCapacityTab): AddCapacityTab | null {
    const index = TABS.findIndex((entry) => entry.tab === current);
    if (key === "Home") return TABS[0]!.tab;
    if (key === "End") return TABS[TABS.length - 1]!.tab;
    if (key === "ArrowRight") return TABS[(index + 1) % TABS.length]!.tab;
    if (key === "ArrowLeft") return TABS[(index - 1 + TABS.length) % TABS.length]!.tab;
    return null;
}

/** The onboard-vps-host form over the provider-account inventory, with notices while that inventory is loading or degraded. */
function ProviderAccountPanel({ inventory }: { inventory: ProviderAccountInventory }) {
    const hosts = useRetainedHosts(inventory.availableHosts);
    const options: AdminActionOption[] = (hosts ?? []).map((host) => ({ label: host.label, value: vpsHostSelectionValue(host) }));
    const notice = providerAccountNotice(inventory, hosts !== null);
    return <>
        {notice !== null && <div role="status" className="mb-4 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm text-foreground">
            <p>{notice.summary}</p>
            {notice.detail !== null && <p className="mt-1 text-xs text-foreground-muted">{notice.detail}</p>}
        </div>}
        {/* Remounts once when the first inventory arrives, so a single listed VPS becomes the preselected choice. */}
        <ControlPlaneActionCard key={hosts === null ? "loading" : "loaded"} operation={PROVIDER_ACCOUNT_OPERATION} title="Onboard provider-account VPS"
            description={PROVIDER_ACCOUNT_DESCRIPTION} fields={providerAccountFields(options)} help={operationExplanation(PROVIDER_ACCOUNT_OPERATION)}
            unavailableReason={hosts !== null ? undefined : inventory.pending ? "Loading provider account inventory…" : "Provider account inventory is unavailable."} />
    </>;
}

/** Keeps the last loaded host list while a later read is pending, so a refresh after onboarding does not reset the form. */
function useRetainedHosts(availableHosts: readonly HostingAdminVpsAvailableHost[] | null) {
    const current = Array.isArray(availableHosts) ? availableHosts : null;
    const [retained, setRetained] = useState(current);
    if (current !== null && current !== retained) setRetained(current);
    return current ?? retained;
}

/** The single host-select field, preselecting the only listed VPS. */
function providerAccountFields(options: AdminActionOption[]): AdminActionField[] {
    return [{ name: "host", label: "Available VPS", kind: "select", required: true, options,
        defaultValue: options.length === 1 ? options[0]!.value : "", help: PROVIDER_ACCOUNT_HOST_HELP }];
}

/** Explains a failed or partial provider-account read, or returns null when the listed hosts are complete and current. */
export function providerAccountNotice(inventory: ProviderAccountInventory, hostsListed: boolean): { summary: string; detail: string | null } | null {
    if (!hostsListed && !inventory.pending) return {
        summary: "Provider account inventory is unavailable, so unregistered VPS products cannot be listed for onboarding. Manual entry still works.",
        detail: inventory.error ?? "The provider account inventory could not be read.",
    };
    if (hostsListed && inventory.error !== null) return { summary: "Showing the last provider account inventory; retrying automatically.", detail: inventory.error };
    if (hostsListed && inventory.failedProviderReads !== null) return { summary: inventory.failedProviderReads, detail: "Manual entry still works." };
    return null;
}
