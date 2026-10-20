"use client";

import { LoaderCircle, Play, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { FieldRequirement, HelpIcon, useOperationTarget } from "./ControlPlaneActionCard";
import {
    emptyManualVpsForm,
    MANUAL_VPS_MAXIMUM_VCPU,
    MANUAL_VPS_MINIMUM_VCPU,
    MANUAL_VPS_OPERATION,
    manualVpsCountryChoices,
    manualVpsLocationChoices,
    manualVpsLoginAddress,
    manualVpsRegion,
    manualVpsSlotCount,
    selectManualVpsRegion,
    validateManualVpsForm,
    type ManualEntryProvider,
    type ManualVpsField,
    type ManualVpsFormValues,
} from "@/app/lib/control-plane/manual-vps";
import { presentControlPlaneOperationResult, type ControlPlaneOperationResultLink } from "@/app/lib/control-plane/presentation";
import { requestControlPlaneAdminWithRefresh } from "@/app/lib/control-plane/stale-request";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { hostingRegionLabel, type HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

type FieldErrors = Partial<Record<ManualVpsField, string>>;
type Result = { ok: boolean; message: string; links: ControlPlaneOperationResultLink[] };

const INPUT_CLASS = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim focus:border-gold disabled:opacity-60 aria-invalid:border-crimson";

/** The "Add manual VPS" operation card: collects a hand-typed host's facts, validates them and submits `onboard-manual-vps-host`. */
export function ManualVpsOnboardingCard({ providers, regions, regionsError, help }: {
    providers: ManualEntryProvider[];
    regions: HostingRegionPayload[] | null;
    // Why the catalog could not be read; shown when `regions` is null.
    regionsError: string | null;
    help?: string;
}) {
    const router = useRouter();
    const { cardRef, isTargeted } = useOperationTarget(MANUAL_VPS_OPERATION);
    const [values, setValues] = useState<ManualVpsFormValues>(() => emptyManualVpsForm(providers));
    const [errors, setErrors] = useState<FieldErrors>({});
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<Result | null>(null);
    const blockedReason = manualVpsBlockedReason(providers, regions, regionsError);

    /** Replaces one field (a region also resets its dependent country and location) and clears its errors. */
    function update(field: ManualVpsField, value: string) {
        setValues((current) => field === "region" ? selectManualVpsRegion(current, regions ?? [], value) : { ...current, [field]: value });
        setErrors((current) => ({ ...current, [field]: undefined, ...(field === "region" ? { countryCode: undefined, locationId: undefined } : {}) }));
    }

    /** Validates locally, asks the administrator to recheck the IPv4, then sends the request and opens the VPS view. */
    async function submit() {
        if (pending || blockedReason !== null) return;
        const validation = validateManualVpsForm(values, { providers, regions: regions ?? [] });
        if (!validation.ok) {
            setErrors(validation.errors);
            return;
        }
        setErrors({});
        const address = manualVpsLoginAddress(validation.input.sshLogin);
        if (!window.confirm(`Onboard ${validation.input.serviceName} at ${address}? Onboarding trusts the pasted host key only at this exact IPv4 address, so confirm it against the provider console.`)) return;
        setPending(true);
        setResult(null);
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const response = await requestControlPlaneAdminWithRefresh({
                accessToken: session.access_token, requestId: crypto.randomUUID(), operation: MANUAL_VPS_OPERATION, input: validation.input,
            }, () => router.refresh());
            setResult({ ok: true, ...presentControlPlaneOperationResult(MANUAL_VPS_OPERATION, response) });
            router.push("/admin/control-plane?view=vps");
        } catch (error) {
            setResult({ ok: false, message: error instanceof Error ? error.message : "The operation failed.", links: [] });
        } finally {
            setPending(false);
        }
    }

    return (
        <article ref={cardRef} id={MANUAL_VPS_OPERATION} tabIndex={-1}
            className={`flex h-full scroll-mt-6 flex-col border border-white/10 bg-surface p-5 outline-none ${isTargeted ? "control-plane-card-targeted" : ""}`}>
            <div className="flex items-center gap-2">
                <h3 className="font-display text-xl font-semibold text-foreground">Add manual VPS</h3>
                {help && <HelpIcon label={`Add manual VPS: ${help}`} help={help} />}
            </div>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">For an already-purchased VPS from a provider without an account API. Type the facts from the provider panel; the control plane revalidates them, pins the pasted host key, installs every managed runner slot, and publishes capacity only after health checks. It never buys, renews, or cancels a VPS.</p>
            <form noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }} className="mt-4 flex flex-1 flex-col">
                <fieldset disabled={blockedReason !== null || pending} className="grid gap-3">
                    <ManualVpsFields values={values} errors={errors} providers={providers} regions={regions ?? []} onChange={update} />
                    <p role="note" className="flex gap-2 border-l-2 border-gold bg-gold/10 px-3 py-2 text-xs leading-5 text-foreground">
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-gold" />
                        <span>Check the IPv4 address twice. Onboarding trusts the pasted host key at that address, so a wrong address could enroll a machine you do not control.</span>
                    </p>
                </fieldset>
                {blockedReason !== null && <p className="mt-3 text-xs leading-5 text-amber-300">{blockedReason}</p>}
                <div className="mt-auto pt-4">
                    <button type="submit" disabled={pending || blockedReason !== null}
                        className="inline-flex min-h-10 w-full items-center justify-center gap-2 border border-crimson bg-crimson px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-crimson-hover disabled:cursor-wait disabled:opacity-60">
                        {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Play aria-hidden="true" className="size-3.5" />}
                        {pending ? "Working" : blockedReason !== null ? "Unavailable" : "Add manual VPS"}
                    </button>
                </div>
            </form>
            {result && <ManualVpsResult result={result} />}
        </article>
    );
}

/** Explains why the form cannot be used now (no manual-entry provider or no catalog), or null when it can. */
export function manualVpsBlockedReason(providers: readonly ManualEntryProvider[], regions: readonly HostingRegionPayload[] | null, regionsError: string | null): string | null {
    if (providers.length === 0) return "No provider currently accepts manual entry. API providers (OVHcloud, Contabo) are onboarded from their account inventory instead.";
    if (regions === null) return `Regions are unavailable: ${regionsError ?? "the catalog could not be read."}`;
    return null;
}

/** Renders the form's inputs, narrowing country and location to the chosen region. */
function ManualVpsFields({ values, errors, providers, regions, onChange }: {
    values: ManualVpsFormValues;
    errors: FieldErrors;
    providers: readonly ManualEntryProvider[];
    regions: readonly HostingRegionPayload[];
    onChange: (field: ManualVpsField, value: string) => void;
}) {
    const region = manualVpsRegion(regions, values.region);
    const countries = manualVpsCountryChoices(region);
    const locations = manualVpsLocationChoices(region);
    const slots = manualVpsSlotCount(values.vCpu);
    const bind = (field: ManualVpsField) => ({ name: field, value: values[field], onChange: (event: { target: { value: string } }) => onChange(field, event.target.value) });
    return <>
        <FormField label="Provider" required error={errors.provider} help="Only providers the control plane accepts by manual entry are listed.">
            {(control) => <select {...control} {...bind("provider")} className={INPUT_CLASS}>
                <option value="" disabled>Select…</option>
                {providers.map((entry) => <option key={entry.provider} value={entry.provider}>{entry.displayName}</option>)}
            </select>}
        </FormField>
        <FormField label="Server name" required error={errors.serviceName} help="A unique, permanent host name, such as the HostHatch panel server ID or hosthatch-ams-1. It cannot be changed later.">
            {(control) => <input {...control} {...bind("serviceName")} autoComplete="off" spellCheck={false} placeholder="hosthatch-ams-1" maxLength={64} className={INPUT_CLASS} />}
        </FormField>
        <FormField label="SSH login" required error={errors.sshLogin} help="root@ and the VPS's public IPv4 address. Only root is accepted.">
            {(control) => <input {...control} {...bind("sshLogin")} autoComplete="off" spellCheck={false} placeholder="root@203.0.113.10" className={INPUT_CLASS} />}
        </FormField>
        <FormField label="Host key" required error={errors.hostPublicKey} help="Onboarding refuses a host presenting any other key."
            hint={<>Copy the output of <code className="font-mono text-foreground">cat /etc/ssh/ssh_host_ed25519_key.pub</code> from the provider console.</>}>
            {(control) => <textarea {...control} {...bind("hostPublicKey")} rows={3} spellCheck={false} placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… root@host" className={`${INPUT_CLASS} py-2 font-mono`} />}
        </FormField>
        <FormField label="vCPU" required error={errors.vCpu} help="Capacity is one game slot per two vCPUs."
            hint={<span aria-live="polite">{slots === null ? `${MANUAL_VPS_MINIMUM_VCPU}–${MANUAL_VPS_MAXIMUM_VCPU} vCPUs.` : `${slots} game ${slots === 1 ? "slot" : "slots"}.`}</span>}>
            {(control) => <input {...control} {...bind("vCpu")} type="number" inputMode="numeric" min={MANUAL_VPS_MINIMUM_VCPU} max={MANUAL_VPS_MAXIMUM_VCPU} step={1} className={INPUT_CLASS} />}
        </FormField>
        <FormField label="Region" required error={errors.region} help="Every region in the stored catalog; the host's country and location must satisfy its placement.">
            {(control) => <select {...control} {...bind("region")} className={INPUT_CLASS}>
                <option value="" disabled>Select…</option>
                {regions.map((entry) => <option key={entry.region} value={entry.region}>{hostingRegionLabel(entry.region)}</option>)}
            </select>}
        </FormField>
        <FormField label="Country" required error={errors.countryCode} help="Limited to the chosen region's countries.">
            {(control) => <select {...control} {...bind("countryCode")} disabled={region === undefined} className={INPUT_CLASS}>
                <option value="" disabled>{region === undefined ? "Choose a region first" : "Select…"}</option>
                {countries.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>}
        </FormField>
        <FormField label="Location" required error={errors.locationId} help={locations === null ? "A short provider location code, such as ams." : "Limited to the chosen region's reviewed locations."}>
            {(control) => locations === null
                ? <input {...control} {...bind("locationId")} disabled={region === undefined} autoComplete="off" spellCheck={false} placeholder="ams" maxLength={128} className={INPUT_CLASS} />
                : <select {...control} {...bind("locationId")} className={INPUT_CLASS}>
                    <option value="" disabled>Select…</option>
                    {locations.map((location) => <option key={location} value={location}>{location}</option>)}
                </select>}
        </FormField>
        <FormField label="Player hostname" required={false} error={errors.publicHostname} help="Optional. A DNS name that already resolves to this IPv4 address; leave blank when the host has none.">
            {(control) => <input {...control} {...bind("publicHostname")} autoComplete="off" spellCheck={false} placeholder="play.example.com" maxLength={253} className={INPUT_CLASS} />}
        </FormField>
        <FormField label="Datacenter" required={false} error={errors.datacenter} help="Display label recorded only in the audit event.">
            {(control) => <input {...control} {...bind("datacenter")} autoComplete="off" placeholder="Amsterdam" maxLength={64} className={INPUT_CLASS} />}
        </FormField>
    </>;
}

/** Labels one control and wires its hint and validation error to it for assistive technology. */
function FormField({ label, required, error, help, hint, children }: {
    label: string;
    required: boolean;
    error: string | undefined;
    help: string;
    hint?: ReactNode;
    children: (control: { id: string; required: boolean; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}) {
    const id = useId();
    const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
    return <div>
        <label htmlFor={id} className="inline-flex items-center gap-1.5 font-label text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-foreground-muted">
            {label}<FieldRequirement required={required} /><HelpIcon label={`${label}: ${help}`} help={help} />
        </label>
        {children({ id, required, "aria-invalid": error !== undefined, "aria-describedby": describedBy })}
        {hint && <p id={`${id}-hint`} className="mt-1 text-[0.65rem] leading-4 text-foreground-dim">{hint}</p>}
        {error && <p id={`${id}-error`} className="mt-1 text-[0.65rem] leading-4 text-red-200">{error}</p>}
    </div>;
}

/** Shows the outcome of the last submission, with links to follow its progress. */
function ManualVpsResult({ result }: { result: Result }) {
    return <div role={result.ok ? "status" : "alert"}
        className={`mt-4 max-h-80 overflow-auto break-words border-l-2 px-3 py-2 text-xs leading-5 ${result.ok ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-crimson bg-crimson/10 text-red-200"}`}>
        <p className="whitespace-pre-wrap font-mono">{result.message}</p>
        {result.links.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
            {result.links.map((link) => <Link key={`${link.label}:${link.href}`} href={link.href}
                className="border border-emerald-300/35 px-3 py-1.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-emerald-100 transition-colors hover:bg-emerald-300/10">{link.label}</Link>)}
        </div>}
    </div>;
}
