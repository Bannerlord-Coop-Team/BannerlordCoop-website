import { getTranslations } from "@/app/lib/localization/server";
import type { Translator } from "@/app/lib/localization/types";
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

/** Formats resource memory for the inventory locale, keeping vendor units intact. */
function memoryLabel(ramMb: number | null, { t, number }: Translator) {
    if (ramMb === null) return t("ionos.unknown");
    if (ramMb % 1024 === 0) return t("ionos.gigabytes", { value: number(ramMb / 1024) });
    return t("ionos.megabytes", { value: number(ramMb) });
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

/** Presents the live IONOS inventory; administrator-only provisioning controls retain their behavior. */
export async function IonosManagementSection({
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
    const translator = await getTranslations("live-server");
    const { t, number } = translator;
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
                                {t("ionos.heading")}
                            </h2>
                            <span className="rounded-sm border border-sky-400/25 bg-sky-400/10 px-2 py-1 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-sky-300">
                                {t("ionos.live")}
                            </span>
                        </div>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
                            {t("ionos.intro")}
                        </p>
                    </div>
                </div>
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryItem
                    icon={Server}
                    label={t("ionos.standard")}
                    value={t("ionos.presetResources", { cores: number(STANDARD_PRESET.cores), memory: memoryLabel(STANDARD_PRESET.ramMb, translator), storage: number(STANDARD_PRESET.storageGb) })}
                />
                <SummaryItem
                    icon={Crown}
                    label={t("ionos.premium")}
                    value={t("ionos.presetResources", { cores: number(PREMIUM_PRESET.cores), memory: memoryLabel(PREMIUM_PRESET.ramMb, translator), storage: number(PREMIUM_PRESET.storageGb) })}
                />
                <SummaryItem icon={HardDrive} label={t("ionos.bootStorage")} value={t("ionos.nvme")} />
                <SummaryItem icon={KeyRound} label={t("ionos.image")} value={provisioning.imageAlias} />
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
                        <p className="font-display text-xl font-semibold text-foreground">{t("ionos.empty")}</p>
                        <p className="mt-2 text-sm text-foreground-muted">
                            {creationEnabled
                                ? t("ionos.firstServer")
                                : t("ionos.creationDisabled")}
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
                                        label={t("ionos.preset")}
                                        value={server.preset ?? t("ionos.custom")}
                                    />
                                    <ServerDetail label={t("ionos.resources")} value={t("ionos.serverResources", { cores: server.cores === null ? "?" : number(server.cores), memory: memoryLabel(server.ramMb, translator) })} />
                                    <ServerDetail label={t("ionos.location")} value={server.location} />
                                    <ServerDetail
                                        label={t("ionos.publicIp")}
                                        value={server.ips.length > 0 ? server.ips.join(", ") : t("ionos.provisioning")}
                                        mono
                                    />
                                </dl>

                                <div className="flex shrink-0 flex-wrap gap-2">
                                    <Link
                                        href={`/servers/${server.id}?datacenterId=${encodeURIComponent(server.datacenterId)}`}
                                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-gold/10 px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:bg-gold/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                                    >
                                        {t("ionos.manage")} <ChevronRight aria-hidden="true" className="size-4" />
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
                    ? t("ionos.networkNotice")
                    : t("ionos.pausedNotice")}
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
