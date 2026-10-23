import { LocalDateTime } from "./LocalDateTime";
import { slotDecommissionPaused } from "@/app/lib/control-plane/slot-decommission";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";

type Onboarding = NonNullable<HostingAdminVpsHost["runnerOnboarding"]>;
type OutOfAdmissionHost = Pick<HostingAdminVpsHost, "provider" | "name"> & { runnerOnboarding: Onboarding };

/**
 * Hosts whose runner onboarding has not succeeded: the control plane admits no new or moved server to any of their free
 * slots until it does. A host that was never enrolled shows its own badge in the table instead.
 */
export function outOfAdmissionHosts(hosts: readonly Pick<HostingAdminVpsHost, "provider" | "name" | "runnerOnboarding">[]): OutOfAdmissionHost[] {
    return hosts.filter((host): host is OutOfAdmissionHost => host.runnerOnboarding !== null && host.runnerOnboarding.state !== "succeeded");
}

/** Lists the hosts out of admission at the top of the VPS tab: failed onboardings as an alert, the rest as a status. */
export function OutOfAdmissionBanner({ hosts }: { hosts: readonly Pick<HostingAdminVpsHost, "provider" | "name" | "runnerOnboarding">[] }) {
    const outOfAdmission = outOfAdmissionHosts(hosts);
    const failed = outOfAdmission.filter(host => host.runnerOnboarding.state === "failed");
    const pending = outOfAdmission.filter(host => host.runnerOnboarding.state !== "failed");
    if (outOfAdmission.length === 0) return null;
    return (
        <div className="mt-5 space-y-3">
            {failed.length > 0 && (
                <section role="alert" aria-label="VPS hosts with a failed onboarding" className="border-l-2 border-red-400/70 bg-red-950/30 p-4 text-xs leading-5 text-red-100">
                    <p className="font-semibold">{failed.length} VPS {failed.length === 1 ? "host is" : "hosts are"} out of admission: onboarding failed</p>
                    <ul className="mt-2 space-y-1">{failed.map(host => <HostLine key={`${host.provider}:${host.name}`} host={host} />)}</ul>
                    <p className="mt-2 text-red-200/80">No new or moved server lands on these hosts until onboarding succeeds. Use Retry onboarding on the host below; failed hosts are listed first.</p>
                </section>
            )}
            {pending.length > 0 && (
                <section role="status" aria-label="VPS hosts with an onboarding in progress" className="border border-gold/25 bg-gold/8 p-4 text-xs leading-5 text-foreground-muted">
                    <p className="font-semibold text-foreground">{pending.length} VPS {pending.length === 1 ? "host is" : "hosts are"} out of admission while onboarding runs</p>
                    <ul className="mt-2 space-y-1">{pending.map(host => <HostLine key={`${host.provider}:${host.name}`} host={host} />)}</ul>
                </section>
            )}
        </div>
    );
}

function HostLine({ host }: { host: OutOfAdmissionHost }) {
    const onboarding = host.runnerOnboarding;
    const status = onboarding.state === "failed" ? "Failed"
        : slotDecommissionPaused(onboarding) ? "Decommission paused"
            : onboarding.state === "retry-wait" ? "Waiting to retry"
                : onboarding.state === "running" ? "Running"
                    : onboarding.state === "queued" ? "Queued" : `State ${String(onboarding.state)}`;
    const attempts = onboarding.attemptCount !== undefined && onboarding.maximumAttempts !== undefined
        ? `, attempt ${String(onboarding.attemptCount)} of ${String(onboarding.maximumAttempts)}` : "";
    return (
        <li>
            <span className="font-semibold">{host.name}</span> ({host.provider}): {status} at <code>{onboarding.progressStage}</code>
            {onboarding.errorCode !== null && <> with <code>{onboarding.errorCode}</code></>}
            {attempts}, since <LocalDateTime value={onboarding.updatedAt} />
            {onboarding.state !== "failed" && onboarding.timeoutAt !== undefined && <>; times out <LocalDateTime value={onboarding.timeoutAt} /></>}
            {onboarding.startedByAutomaticSizing === true && <>; started by automatic slot sizing</>}.
        </li>
    );
}
