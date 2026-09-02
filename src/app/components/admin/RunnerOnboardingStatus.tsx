"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type RunnerOnboarding = NonNullable<HostingAdminVpsHost["runnerOnboarding"]>;
type RunnerUpdate = NonNullable<HostingAdminVpsHost["runnerUpdate"]>;

export function RunnerOnboardingStatus({
    serviceName,
    runningServers,
    targetSourceCommit,
    onboarding,
    update,
}: {
    serviceName: string;
    runningServers: number;
    targetSourceCommit: string | null;
    onboarding: RunnerOnboarding | null;
    update: RunnerUpdate | null;
}) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [requestError, setRequestError] = useState("");
    const onboardingPending = onboarding !== null && isPending(onboarding.state);
    const updatePending = update !== null && isPending(update.state);
    const pending = onboardingPending || updatePending;
    const current = onboarding?.state === "succeeded"
        && targetSourceCommit !== null
        && onboarding.sourceCommit === targetSourceCommit;

    useEffect(() => {
        if (!pending) return;
        const interval = window.setInterval(() => router.refresh(), 4_000);
        return () => window.clearInterval(interval);
    }, [pending, router]);

    async function requestUpdate() {
        if (!window.confirm(`Update every managed-runner slot on ${serviceName}? Every assigned game must already be stopped; the workflow then quiesces and restores only the runner services.`)) {
            return;
        }
        setSubmitting(true);
        setRequestError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            await requestControlPlaneAdmin({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "update-vps-runner",
                input: {
                    serviceName,
                    reason: "Deploy the current reviewed managed-runner release through the transactional fleet workflow.",
                },
            });
            router.refresh();
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : "Runner update could not be requested.");
        } finally {
            setSubmitting(false);
        }
    }

    async function requestOnboarding() {
        setSubmitting(true);
        setRequestError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            await requestControlPlaneAdmin({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "onboard-vps-host",
                input: { serviceName, mode: onboarding === null ? "enroll" : "retry" },
            });
            router.refresh();
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : "Runner onboarding could not be requested.");
        } finally {
            setSubmitting(false);
        }
    }

    if (onboarding === null) {
        return (
            <div>
                <span title="The VPS is registered as provider inventory but has no managed-runner enrollment." className="inline-flex cursor-help border border-gold/25 bg-gold/8 px-2 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold">Not onboarded</span>
                <button
                    type="button"
                    onClick={requestOnboarding}
                    disabled={submitting}
                    title="Run the complete managed-runner enrollment using provider-derived topology and automatic first-contact host-key pinning."
                    className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 border border-gold/35 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:bg-gold/10 disabled:cursor-wait disabled:opacity-60"
                >
                    {submitting ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
                    {submitting ? "Requesting" : "Onboard runner"}
                </button>
                {requestError && <p role="alert" className="mt-2 max-w-56 text-[0.65rem] text-red-200">{requestError}</p>}
            </div>
        );
    }
    const good = onboarding.state === "succeeded";
    const bad = onboarding.state === "failed";
    return (
        <div aria-live={pending ? "polite" : undefined}>
            <span
                title={runnerStateExplanation(onboarding.state)}
                className={`inline-flex cursor-help border px-2 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] ${good ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : bad ? "border-crimson/30 bg-crimson/10 text-red-200" : "border-gold/25 bg-gold/8 text-gold"}`}
            >
                {onboarding.state}
            </span>
            <p className="mt-2 max-w-56 text-[0.65rem] text-foreground-muted">{humanize(onboarding.progressStage)}</p>
            {onboarding.errorCode && <p className="mt-1 max-w-56 font-mono text-[0.6rem] text-red-200">{onboarding.errorCode}</p>}
            {onboarding.sourceCommit && <p className="mt-1 font-mono text-[0.6rem] text-foreground-dim" title={onboarding.sourceCommit}>{onboarding.sourceCommit.slice(0, 12)}</p>}
            {targetSourceCommit && !current && <p className="mt-1 font-mono text-[0.58rem] text-gold/75" title={`Available runner target ${targetSourceCommit}`}>Target {targetSourceCommit.slice(0, 12)}</p>}
            {update && (
                <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.6rem] uppercase tracking-[0.08em] text-foreground-dim">Latest update</span>
                        <RunnerStateBadge state={update.state} explanation={runnerUpdateStateExplanation(update.state)} />
                    </div>
                    <p className="mt-2 max-w-56 text-[0.65rem] text-foreground-muted">{humanize(update.progressStage)}</p>
                    <p className="mt-1 font-mono text-[0.58rem] text-foreground-dim" title={`${update.priorSourceCommit} → ${update.targetSourceCommit}`}>
                        {update.priorSourceCommit.slice(0, 8)} → {update.targetSourceCommit.slice(0, 8)}
                    </p>
                    {update.errorCode && <p className="mt-1 max-w-56 font-mono text-[0.6rem] text-red-200">{update.errorCode}</p>}
                </div>
            )}
            {(onboardingPending || updatePending) && <p className="mt-2 text-[0.58rem] uppercase tracking-[0.08em] text-gold/70">Refreshing progress automatically</p>}
            {bad && (
                <button
                    type="button"
                    onClick={requestOnboarding}
                    disabled={submitting}
                    title="Retry the complete managed-runner enrollment with the durable pinned host identity and a fresh request ID."
                    className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 border border-gold/35 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:bg-gold/10 disabled:cursor-wait disabled:opacity-60"
                >
                    {submitting ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
                    {submitting ? "Requesting" : "Retry onboarding"}
                </button>
            )}
            {good && (
                <button
                    type="button"
                    onClick={requestUpdate}
                    disabled={submitting || updatePending || runningServers > 0 || current}
                    title={current
                        ? "This VPS already runs the control plane's current reviewed runner revision."
                        : runningServers > 0
                        ? "Stop every running Bannerlord server on this VPS before updating its managed runner."
                        : "Deploy the control plane's current reviewed runner revision to every isolated slot. No SSH input is accepted from the browser."}
                    className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 border border-gold/35 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:bg-gold/10 disabled:cursor-wait disabled:opacity-60"
                >
                    {submitting || updatePending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
                    {submitting ? "Requesting" : updatePending ? "Updating" : current ? "Runner current" : runningServers > 0 ? "Stop servers first" : "Update runner"}
                </button>
            )}
            {requestError && <p role="alert" className="mt-2 max-w-56 text-[0.65rem] text-red-200">{requestError}</p>}
        </div>
    );
}

function RunnerStateBadge({ state, explanation }: { state: RunnerUpdate["state"]; explanation: string }) {
    const good = state === "succeeded";
    const bad = state === "failed";
    return (
        <span
            title={explanation}
            className={`inline-flex cursor-help border px-2 py-0.5 font-label text-[0.55rem] font-semibold uppercase tracking-[0.08em] ${good ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : bad ? "border-crimson/30 bg-crimson/10 text-red-200" : "border-gold/25 bg-gold/8 text-gold"}`}
        >
            {state}
        </span>
    );
}

function isPending(state: RunnerOnboarding["state"] | RunnerUpdate["state"]) {
    return ["queued", "running", "retry-wait"].includes(state);
}

function humanize(value: string) {
    return value.replaceAll("-", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function runnerStateExplanation(state: RunnerOnboarding["state"]) {
    switch (state) {
        case "queued": return "The durable runner-enrollment request is waiting for the control-plane worker.";
        case "running": return "The control plane is installing or verifying the managed runner and its isolated slots.";
        case "retry-wait": return "A retryable enrollment step failed; the durable workflow will resume after backoff.";
        case "succeeded": return "Every prepared slot has an active private route and verified mTLS agent health, so capacity is available.";
        case "failed": return "Runner enrollment stopped safely after a terminal error. The error code identifies the failed boundary.";
    }
}

function runnerUpdateStateExplanation(state: RunnerUpdate["state"]) {
    switch (state) {
        case "queued": return "The durable host-wide runner update is waiting for the fleet worker.";
        case "running": return "Every slot is being updated transactionally with stopped-state continuity checks.";
        case "retry-wait": return "A retryable update boundary failed; the durable workflow will resume after backoff.";
        case "succeeded": return "Every isolated slot passed revision, identity, build, save, and capability verification.";
        case "failed": return "The update stopped safely after a terminal error; the retained prior revision remains the rollback target.";
    }
}
