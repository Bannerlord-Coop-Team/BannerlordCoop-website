import {
    CreateIonosServerForm,
    DestroyIonosServerButton,
} from "@/app/components/servers/IonosServerButtons";
import type {
    IonosLocation,
    IonosProvisioningSummary,
    ManagedIonosServer,
} from "@/app/lib/ionos/client";
import { getIonosServerPreset } from "@/app/lib/ionos/resources";
import {
    ChevronRight,
    CloudCog,
    Cpu,
    Crown,
    HardDrive,
    KeyRound,
    Network,
    Server,
} from "lucide-react";
import Link from "next/link";

function memoryLabel(ramMb: number | null) {
    if (ramMb === null) return "Unknown";
    if (ramMb % 1024 === 0) return `${ramMb / 1024} GB`;
    return `${ramMb} MB`;
}

const STANDARD_PRESET = getIonosServerPreset("Standard");
const PREMIUM_PRESET = getIonosServerPreset("Premium");

function stateStyle(state: string) {
    if (state === "AVAILABLE" || state === "RUNNING") {
        return "bg-emerald-400 text-emerald-300";
    }
    if (state === "BUSY") return "bg-gold text-gold";
    return "bg-foreground-dim text-foreground-muted";
}

export function IonosManagementSection({
    creationEnabled,
    isAdmin,
    loadError,
    locations,
    provisioning,
    servers,
}: {
    creationEnabled: boolean;
    isAdmin: boolean;
    loadError: string;
    locations: IonosLocation[];
    provisioning: IonosProvisioningSummary;
    servers: ManagedIonosServer[];
}) {
    return (
        <section
            className="mt-8 rounded-sm border border-sky-400/20 bg-[linear-gradient(120deg,rgba(56,189,248,0.07),rgba(17,18,15,0.82)_45%)] p-5 sm:p-6"
            aria-labelledby="ionos-heading"
        >
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-sm border border-sky-400/25 bg-sky-400/10 text-sky-300">
                        <CloudCog aria-hidden="true" className="size-5" />
                    </span>
                    <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                            <h2 id="ionos-heading" className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
                                IONOS infrastructure
                            </h2>
                            <span className="rounded-sm border border-sky-400/25 bg-sky-400/10 px-2 py-1 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-sky-300">
                                Live
                            </span>
                        </div>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
                            This is the live IONOS inventory. Existing managed resources remain available, but new-server provisioning is currently paused.
                        </p>
                    </div>
                </div>
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryItem
                    icon={Server}
                    label="Standard · Cube S"
                    value={`${STANDARD_PRESET.cores} vCPU · ${memoryLabel(STANDARD_PRESET.ramMb)} · ${STANDARD_PRESET.storageGb} GB NVMe`}
                />
                <SummaryItem
                    icon={Crown}
                    label="Premium · Cube M"
                    value={`${PREMIUM_PRESET.cores} vCPU · ${memoryLabel(PREMIUM_PRESET.ramMb)} · ${PREMIUM_PRESET.storageGb} GB NVMe`}
                />
                <SummaryItem icon={HardDrive} label="Boot storage" value="Direct-attached NVMe" />
                <SummaryItem icon={KeyRound} label="Image" value={provisioning.imageAlias} />
            </dl>

            {isAdmin && creationEnabled && !loadError && (
                <CreateIonosServerForm
                    defaults={provisioning}
                    locations={locations}
                />
            )}

            {isAdmin && !creationEnabled && !loadError && (
                <p className="mt-5 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-sm text-foreground-muted" role="status">
                    IONOS server creation is disabled while alternative hosting options are evaluated.
                </p>
            )}

            {loadError && (
                <p className="mt-5 border-l-2 border-red-400 bg-red-500/[0.07] px-4 py-3 text-sm text-red-200" role="alert">
                    {loadError}
                </p>
            )}

            <div className="mt-6 grid gap-3">
                {!loadError && servers.length === 0 && (
                    <div className="rounded-sm border border-dashed border-white/15 bg-background/45 px-5 py-8 text-center">
                        <p className="font-display text-xl font-semibold text-foreground">No managed IONOS servers</p>
                        <p className="mt-2 text-sm text-foreground-muted">
                            {creationEnabled
                                ? "The first Create server operation also creates the website-managed data center and public LAN."
                                : "New IONOS server provisioning is currently disabled."}
                        </p>
                    </div>
                )}

                {servers.map((server) => {
                    const displayedState = server.vmState !== "UNKNOWN"
                        ? server.vmState
                        : server.provisioningState;
                    const style = stateStyle(displayedState);

                    return (
                        <article key={server.id} className="rounded-sm border border-white/10 bg-background/60 p-4 sm:p-5">
                            <div className="flex flex-col gap-5 xl:flex-row xl:items-center">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2.5">
                                        <h3 className="truncate font-display text-xl font-semibold text-foreground sm:text-2xl">
                                            {server.name}
                                        </h3>
                                        <span className={`inline-flex items-center gap-1.5 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${style.split(" ")[1]}`}>
                                            <span aria-hidden="true" className={`size-1.5 rounded-full ${style.split(" ")[0]}`} />
                                            {displayedState}
                                        </span>
                                    </div>
                                    <p className="mt-1 font-mono text-[0.68rem] text-foreground-dim">
                                        {server.id}
                                    </p>
                                </div>

                                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:min-w-150">
                                    <ServerDetail
                                        label="Preset"
                                        value={server.preset ?? "Custom"}
                                    />
                                    <ServerDetail label="Resources" value={`${server.cores ?? "?"} vCPU · ${memoryLabel(server.ramMb)}`} />
                                    <ServerDetail label="Location" value={server.location} />
                                    <ServerDetail
                                        label="Public IP"
                                        value={server.ips.length > 0 ? server.ips.join(", ") : "Provisioning"}
                                        mono
                                    />
                                </dl>

                                <div className="flex shrink-0 flex-wrap gap-2">
                                    <Link
                                        href={`/servers/${server.id}?datacenterId=${encodeURIComponent(server.datacenterId)}`}
                                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-gold/10 px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:bg-gold/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                                    >
                                        Manage <ChevronRight aria-hidden="true" className="size-4" />
                                    </Link>
                                    {isAdmin && (
                                        <DestroyIonosServerButton
                                            datacenterId={server.datacenterId}
                                            serverId={server.id}
                                            serverName={server.name}
                                        />
                                    )}
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>

            <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-foreground-dim">
                <Network aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {creationEnabled
                    ? "New Cubes use a public LAN with an ingress firewall that permits SSH on TCP 22 only. Game ports and Bannerlord deployment are not configured yet."
                    : "Inventory and destruction support remain available for previously managed IONOS resources."}
            </p>
        </section>
    );
}

function SummaryItem({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Cpu;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-sm border border-white/10 bg-background/55 px-4 py-3">
            <dt className="flex items-center gap-1.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">
                <Icon aria-hidden="true" className="size-3.5" /> {label}
            </dt>
            <dd className="mt-1.5 truncate text-sm font-medium text-foreground-muted" title={value}>{value}</dd>
        </div>
    );
}

function ServerDetail({
    label,
    mono = false,
    value,
}: {
    label: string;
    mono?: boolean;
    value: string;
}) {
    return (
        <div>
            <dt className="font-label text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-foreground-dim">{label}</dt>
            <dd className={`mt-1 truncate text-xs text-foreground-muted ${mono ? "font-mono" : ""}`} title={value}>{value}</dd>
        </div>
    );
}
