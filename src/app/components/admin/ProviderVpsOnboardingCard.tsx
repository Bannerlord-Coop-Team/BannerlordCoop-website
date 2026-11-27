"use client";

import { ControlPlaneActionCard, type AdminActionField, type AdminActionOption } from "./ControlPlaneActionCard";
import { operationExplanation } from "@/app/lib/control-plane/explanations";
import { PROVIDER_VPS_OPERATION, vpsHostSelectionValue } from "@/app/lib/control-plane/vps-providers";
import { billingListedHosts, type BillingReadState } from "@/app/lib/control-plane/vps-billing-state";

/** A notice explaining a failed or partial provider-account read; `retryable` when reading again could recover it. */
export type ProviderAccountNotice = { summary: string; detail: string; retryable: boolean };

const DESCRIPTION = "For OVHcloud and Contabo, whose account APIs list purchased VPSes. Choose one already-purchased VPS, then click Onboard VPS. The control plane revalidates it against its provider account (identity, location, vCPU capacity, and primary IPv4); acquires and pins its Ed25519 host identity; uses the preinstalled fleet-operator key; installs and hardens every managed runner slot; establishes private mTLS routes; and publishes capacity only after health checks. It never buys, renews, or cancels a VPS.";
const HOST_HELP = "Only unregistered VPS products discovered in the authenticated provider accounts are shown, each with its provider. Select the saved bannerlord-fleet-operator key when installing the VPS; no SSH key, IP address, vCPU count, region, or audit reason is entered here. For a provider without an account API, use the Manual entry tab.";

/** The "Onboard provider-account VPS" form: picks one unregistered account host and submits `onboard-vps-host`, with read notices. */
export function ProviderVpsOnboardingCard({ state, onRetry }: { state: BillingReadState; onRetry: () => void }) {
    const options: AdminActionOption[] = (billingListedHosts(state) ?? []).map((host) => ({ label: host.label, value: vpsHostSelectionValue(host) }));
    const notice = providerAccountNotice(state);
    return <>
        {notice !== null && <div role="status" className="mb-4 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm text-foreground">
            <p>{notice.summary}</p>
            <p className="mt-1 text-xs text-foreground-muted">{notice.detail}</p>
            {notice.retryable && <button type="button" onClick={onRetry} className="mt-2 text-xs text-gold underline underline-offset-2 hover:text-foreground">Retry provider inventory</button>}
        </div>}
        <ControlPlaneActionCard operation={PROVIDER_VPS_OPERATION} title="Onboard provider-account VPS" description={DESCRIPTION}
            fields={providerAccountFields(options)} help={operationExplanation(PROVIDER_VPS_OPERATION)}
            unavailableReason={providerAccountUnavailableReason(state)} submitLabel="Onboard VPS" />
    </>;
}

/** Why the form cannot submit while no hosts are listed (loading or failed), or undefined once they are. */
export function providerAccountUnavailableReason(state: BillingReadState): string | undefined {
    if (state.kind === "loading") return "Loading provider account inventory…";
    if (state.kind === "failed") return "Provider account inventory is unavailable.";
    return undefined;
}

/** The notice for the billing read's state: unavailable, retained listing, or failed provider accounts; null while loading or complete. */
export function providerAccountNotice(state: BillingReadState): ProviderAccountNotice | null {
    if (state.kind === "failed") return unavailableNotice(state.error);
    if (state.kind === "stale") return staleNotice(state.error);
    if (state.kind === "partial") return partialNotice(state.failedProviderReads);
    return null;
}

/** No hosts could be listed; reading again may recover. */
function unavailableNotice(error: string): ProviderAccountNotice {
    return { summary: "Provider account inventory is unavailable, so unregistered VPS products cannot be listed for onboarding. Manual entry still works.", detail: error, retryable: true };
}

/** A later read failed, so the hosts shown are from the last successful one; reading again may recover. */
function staleNotice(error: string): ProviderAccountNotice {
    return { summary: "Showing the last provider account inventory; retrying automatically.", detail: error, retryable: true };
}

/** Some provider accounts could not be read, so their hosts are missing. */
function partialNotice(failedProviderReads: string): ProviderAccountNotice {
    return { summary: failedProviderReads, detail: "Manual entry still works.", retryable: false };
}

/** The single host-select field, preselecting the only listed VPS. */
function providerAccountFields(options: AdminActionOption[]): AdminActionField[] {
    return [{ name: "host", label: "Available VPS", kind: "select", required: true, options,
        defaultValue: options.length === 1 ? options[0]!.value : "", help: HOST_HELP }];
}
