"use client";

import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type RunnerOnboarding = NonNullable<HostingAdminVpsHost["runnerOnboarding"]>;

export function RunnerOnboardingStatus({ onboarding }: { onboarding: RunnerOnboarding | null }) {
    const router = useRouter();
    const pending = onboarding !== null && ["queued", "running", "retry-wait"].includes(onboarding.state);

    useEffect(() => {
        if (!pending) return;
        const interval = window.setInterval(() => router.refresh(), 4_000);
        return () => window.clearInterval(interval);
    }, [pending, router]);

    if (onboarding === null) {
        return <span title="The VPS is registered as provider inventory but has no managed-runner enrollment." className="inline-flex cursor-help border border-gold/25 bg-gold/8 px-2 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold">Not onboarded</span>;
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
            {pending && <p className="mt-1 text-[0.58rem] uppercase tracking-[0.08em] text-gold/70">Updating automatically</p>}
        </div>
    );
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
