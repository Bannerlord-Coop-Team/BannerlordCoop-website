import { COLD_SLEEP_LABEL, isColdSleeping } from "@/app/lib/hosting/cold-sleep";
import { LocalDateTime } from "./LocalDateTime";
import { AuditReadTable } from "./ControlPlaneReadTables";
import { stateExplanation } from "@/app/lib/control-plane/explanations";
import { releaseVersion } from "@/app/lib/control-plane/presentation";
import type { Backup, AuditEvent, ReleaseBuild } from "@/app/lib/control-plane/types";

export function BackupsTable({ backups }: { backups: Backup[] }) { return <div className="mt-4 overflow-x-auto border border-white/10 bg-surface"><table className="w-full min-w-200 text-left text-sm"><thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted"><tr><th className="p-4">Backup</th><th className="p-4">Type</th><th className="p-4">State</th><th className="p-4">Size</th><th className="p-4">Created</th><th className="p-4">Expires</th></tr></thead><tbody className="divide-y divide-white/10">{backups.map((backup) => <tr key={backup.backupId}><td className="p-4 font-mono text-xs text-foreground-muted">{backup.backupId}</td><td className="p-4 text-xs text-foreground-muted">{backup.backupType}</td><td className="p-4"><State value={backup.restoreState} /></td><td className="p-4 text-xs text-foreground-muted">{formatBytes(backup.byteSize)}</td><td className="p-4 text-xs text-foreground-muted"><LocalDateTime value={backup.createdAt} /></td><td className="p-4 text-xs text-foreground-muted"><LocalDateTime value={backup.retentionExpiresAt} /></td></tr>)}</tbody></table>{backups.length === 0 && <Empty>No retained backups.</Empty>}</div>; }

export function AuditTable({ events }: { events: AuditEvent[] }) {
    return <AuditReadTable events={events.map(event => ({
        eventId: event.eventId, occurredAt: event.occurredAt, action: event.action, actorType: event.actorType,
        actorLabel: shortId(event.actorId), serverLabel: shortId(event.targetServerId), reason: event.reason,
        correlationLabel: shortId(event.correlationId),
    }))} />;
}

/** Shows authoritative label values, without inferring compatibility for historical builds. */
export function ReleaseMetadata({ build }: { build: ReleaseBuild }) {
    const sourceRevision = build.sourceRevision === "registry-observed"
        ? "Unavailable (registry-observed)"
        : build.sourceRevision;
    return <details className="mt-3 text-xs text-foreground-muted"><summary className="cursor-pointer py-2">Release label details</summary>
        {build.registryMetadata ? <dl className="divide-y divide-white/10">
            {[
                ["Recorded source revision", sourceRevision],
                ["io.bannerlordcoop.client.revision", build.registryMetadata.clientRevision],
                ["io.bannerlordcoop.client.version", build.requiredClientModVersion],
                ["io.bannerlordcoop.dedicated-server.revision", build.registryMetadata.serverRevision],
                ["io.bannerlordcoop.game.version", build.supportedGameVersion],
            ].map(([label, value]) => <div key={label} className="py-2 text-left">
                <dt className="break-all">{label}</dt><dd className="mt-1 break-all font-mono text-foreground">{value ?? "Unavailable"}</dd>
            </div>)}
        </dl> : <>
            <p className="py-2">Verified registry labels are unavailable for this historical version.</p>
            <dl className="divide-y divide-white/10">
                <div className="py-2 text-left">
                    <dt className="break-all">Recorded source revision</dt>
                    <dd className="mt-1 break-all font-mono text-foreground">{sourceRevision}</dd>
                </div>
            </dl>
        </>}
    </details>;
}

/** Keeps recorded versions visible even when absent from GHCR discovery. */
export function RecordedRelease({ build, buildId }: { build: ReleaseBuild | null; buildId: string | null }) {
    if (!build) return <>{buildId ? `Metadata unavailable (${buildId})` : "None"}</>;
    return <div><span>{releaseVersion(build)}</span><ReleaseMetadata build={build} /></div>;
}

export function Panel({ title, children, help }: { title: string; children: React.ReactNode; help?: string }) { return <section className="border border-white/10 bg-surface p-5"><h2 className={`font-display text-2xl font-semibold text-foreground ${help ? "cursor-help" : ""}`} title={help}>{title}</h2><dl className="mt-4 divide-y divide-white/10">{children}</dl></section>; }

export function Definition({ label, value, tone, help }: { label: string; value: React.ReactNode; tone?: "ok" | "warning"; help?: string }) { return <div className="flex items-start justify-between gap-4 py-3 text-xs"><dt className={`${help ? "cursor-help underline decoration-dotted underline-offset-4" : ""} text-foreground-muted`} title={help} aria-label={help ? `${label}: ${help}` : undefined}>{label}</dt><dd className={`max-w-[65%] break-words text-right font-medium ${tone === "ok" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-foreground"}`}>{value}</dd></div>; }

export function SectionHeading({ eyebrow, title, count }: { eyebrow: string; title: string; count: number }) { return <div className="flex items-end justify-between gap-4"><div><p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p><h2 className="mt-1 font-display text-3xl font-semibold text-foreground">{title}</h2></div><span className="font-display text-xl text-foreground-muted">{count}</span></div>; }

export function State({ value, desiredState }: { value: string; desiredState?: string }) { const label = isColdSleeping(value, desiredState) ? COLD_SLEEP_LABEL : value; const good = ["running", "succeeded", "validated", "available", "healthy"].includes(value); const bad = ["failed", "degraded", "revoked", "rejected", "cancelled", "unavailable"].includes(value); const explanation = stateExplanation(value, desiredState); return <span title={explanation} aria-label={`${label}: ${explanation}`} className={`inline-flex cursor-help border px-2 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] ${good ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : bad ? "border-crimson/30 bg-crimson/10 text-red-200" : "border-gold/25 bg-gold/8 text-gold"}`}>{label}</span>; }

export function Empty({ children }: { children: React.ReactNode }) { return <div className="px-6 py-12 text-center text-sm text-foreground-muted">{children}</div>; }

export function formatBytes(value: number) { return value < 1_048_576 ? `${Math.round(value / 1024)} KiB` : `${(value / 1_048_576).toFixed(1)} MiB`; }

export function shortId(value: string | null) { return value ? (value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value) : "—"; }
