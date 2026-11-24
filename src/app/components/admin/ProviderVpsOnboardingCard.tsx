"use client";

import { ControlPlaneActionCard, type AdminActionField, type AdminActionOption } from "./ControlPlaneActionCard";
import { operationExplanation } from "@/app/lib/control-plane/explanations";
import { PROVIDER_VPS_OPERATION, vpsHostSelectionValue } from "@/app/lib/control-plane/vps-providers";
import type { HostingAdminVpsAvailableHost } from "@/app/lib/control-plane/types";

/** The provider-account inventory the form offers: its hosts once any read has listed them (null before), and why reads failed. */
export type ProviderAccountInventory = {
    availableHosts: readonly HostingAdminVpsAvailableHost[] | null;
    pending: boolean;
    error: string | null;
    failedProviderReads: string | null;
};

/** A notice explaining a failed or partial provider-account read; `retryable` when reading again could recover it. */
export type ProviderAccountNotice = { summary: string; detail: string | null; retryable: boolean };

const DESCRIPTION = "For OVHcloud and Contabo, whose account APIs list purchased VPSes. Choose one already-purchased VPS, then click Onboard VPS. The control plane revalidates it against its provider account (identity, location, vCPU capacity, and primary IPv4); acquires and pins its Ed25519 host identity; uses the preinstalled fleet-operator key; installs and hardens every managed runner slot; establishes private mTLS routes; and publishes capacity only after health checks. It never buys, renews, or cancels a VPS.";
const HOST_HELP = "Only unregistered VPS products discovered in the authenticated provider accounts are shown, each with its provider. Select the saved bannerlord-fleet-operator key when installing the VPS; no SSH key, IP address, vCPU count, region, or audit reason is entered here. For a provider without an account API, use the Manual entry tab.";

/** The "Onboard provider-account VPS" form: picks one unregistered account host and submits `onboard-vps-host`, with read notices. */
export function ProviderVpsOnboardingCard({ inventory, onRetry }: { inventory: ProviderAccountInventory; onRetry: () => void }) {
    const options: AdminActionOption[] = (inventory.availableHosts ?? []).map((host) => ({ label: host.label, value: vpsHostSelectionValue(host) }));
    const notice = providerAccountNotice(inventory);
    return <>
        {notice !== null && <div role="status" className="mb-4 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm text-foreground">
            <p>{notice.summary}</p>
            {notice.detail !== null && <p className="mt-1 text-xs text-foreground-muted">{notice.detail}</p>}
            {notice.retryable && <button type="button" onClick={onRetry} className="mt-2 text-xs text-gold underline underline-offset-2 hover:text-foreground">Retry provider inventory</button>}
        </div>}
        <ControlPlaneActionCard operation={PROVIDER_VPS_OPERATION} title="Onboard provider-account VPS" description={DESCRIPTION}
            fields={providerAccountFields(options)} help={operationExplanation(PROVIDER_VPS_OPERATION)}
            unavailableReason={providerAccountUnavailableReason(inventory)} submitLabel="Onboard VPS" />
    </>;
}

/** Why the form cannot submit while no hosts are listed (loading or failed), or undefined once they are. */
export function providerAccountUnavailableReason(inventory: ProviderAccountInventory): string | undefined {
    if (inventory.availableHosts !== null) return undefined;
    if (inventory.pending) return "Loading provider account inventory…";
    return "Provider account inventory is unavailable.";
}

/** Explains a failed read, a retained earlier listing, or failed provider accounts, in that precedence; null when complete. */
export function providerAccountNotice(inventory: ProviderAccountInventory): ProviderAccountNotice | null {
    if (inventory.availableHosts === null && inventory.pending) return null;
    if (inventory.availableHosts === null) return {
        summary: "Provider account inventory is unavailable, so unregistered VPS products cannot be listed for onboarding. Manual entry still works.",
        detail: inventory.error ?? "The provider account inventory could not be read.",
        retryable: true,
    };
    if (inventory.error !== null) return { summary: "Showing the last provider account inventory; retrying automatically.", detail: inventory.error, retryable: true };
    if (inventory.failedProviderReads !== null) return { summary: inventory.failedProviderReads, detail: "Manual entry still works.", retryable: false };
    return null;
}

/** The single host-select field, preselecting the only listed VPS. */
function providerAccountFields(options: AdminActionOption[]): AdminActionField[] {
    return [{ name: "host", label: "Available VPS", kind: "select", required: true, options,
        defaultValue: options.length === 1 ? options[0]!.value : "", help: HOST_HELP }];
}
