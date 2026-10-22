import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";
import type { VpsProviderId, VpsProviderRead } from "./vps-providers";
import type { ManualEntryProvider } from "./manual-vps";

export type ManagedServer = {
    serverId: string;
    ownerDiscordUserId: string;
    /** Administrator display identity; omitted by older control-plane releases. */
    ownerAccountId?: string | null;
    displayName: string;
    provider: string;
    providerResourceId: string | null;
    providerLocationId: string | null;
    friendlyRegion: string;
    desiredState: string;
    observedVmState: string;
    observedGameState: string;
    operationState: string;
    releaseChannel: "stable" | "nightly";
    installedBuildId: string | null;
    desiredBuildId: string | null;
    pinnedBuildId: string | null;
    maintenanceSlot: string;
    activeSaveId: string | null;
    connectionHostname: string | null;
    connectionIp: string | null;
    gamePorts: number[];
    deletionDueAt: string | null;
    lastHealthCheckAt: string | null;
    lastErrorCode: string | null;
    createdAt: string;
    updatedAt: string;
};

export type MyServerSummary = Pick<
    ManagedServer,
    | "serverId"
    | "displayName"
    | "friendlyRegion"
    | "operationState"
    | "observedGameState"
    | "releaseChannel"
    | "updatedAt"
> & {
    runtimeInsight?: import("../hosting/owner-runtime-insight").OwnerRuntimeInsight;
    accessRole: "owner" | "manager" | "support" | "admin";
    // Missing visibility is treated as private during the control-plane rollout.
    visibility?: "private" | "public";
    // Missing maintenance fields disable these settings until the control plane is updated.
    maintenanceSlot?: string;
    timezone?: string;
    // CP #143 supplies these stored fields through authenticated my-servers.
    // Optional for older deployments; independent of the visibility rollout.
    connectionIp?: string | null;
    gamePorts?: number[];
};

/** A notice on one server's page that this viewer has not dismissed. Placement kinds carry typed parameters. */
export type MyServerNotice = {
    noticeId: string;
    kind: "administrator" | "placement-scheduled" | "placement-completed";
    severity: "info" | "warning";
    title: string;
    body: string;
    parameters: Record<string, string | number | boolean | null>;
    createdAt: string;
    expiresAt: string | null;
};

/**
 * One server's move to another machine as its page shows it: announced, under way, or finished in the
 * last 24 hours. `step` is set only while moving or returning, `address` only once moved and
 * `stayedOnOriginal` only when the move failed.
 */
export type MyServerMove = {
    state: "scheduled" | "starting" | "moving" | "returning" | "moved" | "failed";
    scheduledAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    step: "preparing" | "saving-and-stopping" | "backing-up" | "restoring" | "switching-address" | "starting-game" | "finishing" | null;
    address: string | null;
    stayedOnOriginal: boolean | null;
};

export type MyServerSaveSummary = {
    saveId: string;
    displayName: string;
    byteSize: number;
    createdAt: string;
    lastUsedAt: string | null;
    importedBy: "system" | "owner";
};

export type MyServerSavePage = {
    serverId: string;
    updatedAt: string;
    activeSaveId: string | null;
    items: MyServerSaveSummary[];
    nextCursor: string | null;
};

/** The active campaign's current save and earlier autosave copies; may be a few minutes stale. */
export type {
    RestorableSaveGeneration as MyServerRestorableSaveGeneration,
    SaveGeneration as MyServerSaveGeneration,
    SaveGenerationList as MyServerSaveGenerationList,
    SaveGenerationSummary as MyServerSaveGenerationSummary,
} from "../../../../supabase/functions/_shared/server-save-generation-contract";

export type MyServerBackupSummary = {
    backupId: string;
    backupType: string;
    byteSize: number;
    createdAt: string;
    retentionExpiresAt: string;
    restoreState: string;
    restoredAt: string | null;
    canRestore: boolean;
    // Optional while older control-plane releases still return only canRestore.
    restoreUnavailableReason?: "expired" | "restore_in_progress" | "installed_build_unknown" | "backup_build_unknown" | "build_mismatch" | null;
};

export type MyServerBackupJob = {
    jobId: string;
    action: "backup" | "restore";
    state: "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled";
    progress: string;
    createdAt: string;
    updatedAt: string;
};

export type MyServerBackupStatus = {
    serverId: string;
    updatedAt: string;
    operationState: string;
    observedGameState: string;
    job: MyServerBackupJob | null;
};

export type HostingJob = {
    jobId: string;
    serverId: string;
    action: string;
    authority: string;
    state: string;
    attemptCount: number;
    maximumAttempts: number;
    progressStage: string;
    errorCode: string | null;
    runAt: string;
    createdAt: string;
    updatedAt: string;
    failureAcknowledgedAt?: string | null;
    failureAcknowledgedBy?: string | null;
};

export type HostingJobProgress = Pick<HostingJob, "jobId" | "serverId" | "action" | "state"
    | "progressStage" | "errorCode" | "attemptCount" | "maximumAttempts" | "updatedAt">;
export type ServerProgress = {
    server: Pick<ManagedServer, "serverId" | "updatedAt" | "operationState" | "desiredState"
        | "observedVmState" | "observedGameState"> & { softDeletedAt: string | null };
    activeJob: HostingJobProgress | null;
};

export type ReleaseBuild = {
    registryMetadata?: { versionTag: string; clientRevision: string; serverRevision: string };
    container?: { manifestDigest: string } | null;
    firstObservedAt?: string;
    currentChannel?: boolean;
    requiredClientModVersion?: string;
    buildId: string;
    channel: "stable" | "nightly";
    version: string;
    sourceRevision: string;
    supportedGameVersion: string;
    validationState: string;
    publishedAt: string;
    updatedAt: string;
};

export type Backup = {
    backupId: string;
    serverId: string;
    backupType: string;
    byteSize: number;
    buildId: string | null;
    saveId: string | null;
    retentionExpiresAt: string;
    createdAt: string;
    restoreState: string;
    lastErrorCode: string | null;
};

export type AuditEvent = {
    eventId: string;
    actorType: string;
    actorId: string;
    targetDiscordUserId: string | null;
    targetServerId: string | null;
    action: string;
    reason: string | null;
    correlationId: string;
    occurredAt: string;
};

export type HostingPage<T> = { items: T[]; nextCursor: string | null };

export type HostingAdminHostResources = {
    observedAt: string;
    uptimeSeconds: number;
    cpuPercent: number;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    diskUsedBytes: number;
    diskFreeBytes: number;
    diskTotalBytes: number;
};

export type HostingServerResources = {
    observedAt: string;
    sampleDurationMs: number;
    cpuVcpus: number;
    cpuLimitVcpus: number;
    memoryUsedBytes: number;
    memoryLimitBytes: number;
};

export type HostingAdminVpsHost = {
    /** The provider that owns this host; host-scoped admin requests send it back unchanged. */
    provider: VpsProviderId;
    name: string;
    locationId: string;
    // Provider-reported ISO country, present for every host.
    countryCode: string;
    // Legacy region a retained host was registered with; null for hosts registered from provider facts.
    region: string | null;
    totalSlots: number;
    runningServers: number;
    availableServers: number;
    occupiedSlots: Array<{
        slotIndex: number;
        gamePort: number;
        serverId: string;
        displayName: string;
        ownerDiscordUserId: string;
        ownerAccountId?: string | null;
        operationState: string;
        resources?: HostingServerResources | null;
    }>;
    cost: {
        priceInMicrocents: number;
        currencyCode: string;
        duration: string;
        interval: number;
    } | null;
    expirationDate: string | null;
    autoRenew: boolean | null;
    providerCheckedAt: string | null;
    resources: HostingAdminHostResources | null;
    runnerOnboarding: {
        state: "queued" | "running" | "retry-wait" | "succeeded" | "failed";
        progressStage: string;
        errorCode: string | null;
        sourceCommit: string | null;
        updatedAt: string;
    } | null;
    runnerUpdate?: {
        state: "queued" | "running" | "retry-wait" | "succeeded" | "failed";
        progressStage: string;
        errorCode: string | null;
        targetSourceCommit: string;
        priorSourceCommit: string;
        updatedAt: string;
    } | null;
};

/** The control plane's result of `raise-vps-slot-capacity` for one VPS. */
export type HostingRaiseVpsSlotCapacityResult = {
    /** `raised` grew the capacity and queued the onboarding that commissions the new slots; `unchanged` already had it. */
    outcome: "raised" | "unchanged";
    provider: VpsProviderId;
    serviceName: string;
    vCpu: number;
    /** Equal to `slotCapacity` when unchanged. */
    previousSlotCapacity: number;
    slotCapacity: number;
    /** As the VPS table shows it; null only for an unchanged VPS that was never onboarded. */
    runnerOnboarding: HostingAdminVpsHost["runnerOnboarding"];
};

/**
 * The control plane's result of `decommission-vps-slots` for one VPS: `draining` (planned, its tail still holds
 * servers), `queued`, `unchanged`, or a replay of a settled request (`completed`, `cancelled`, `superseded`).
 */
export type HostingDecommissionVpsSlotsResult = {
    outcome: "draining" | "queued" | "unchanged" | "completed" | "cancelled" | "superseded";
    provider: VpsProviderId;
    serviceName: string;
    vCpu: number;
    /** The VPS's stored slot capacity now, which drops only when the decommission completes. */
    slotCapacity: number;
    /** The VPS's slot target now; a decommission plan sets it to the capacity the VPS is lowered to. */
    targetSlots: number | null;
    /** The zero-based slots of the decommissioned tail that still hold, or are reserved for, a server. */
    occupiedSlotIndexes: number[];
    /** As the VPS table shows it; null only for a VPS that was never onboarded. */
    runnerOnboarding: HostingAdminVpsHost["runnerOnboarding"];
};

/** The control plane's result of `cancel-vps-slot-decommission`: `cancelled` the open plan, or `unchanged` with none. */
export type HostingCancelVpsSlotDecommissionResult = {
    outcome: "cancelled" | "unchanged";
    provider: VpsProviderId;
    serviceName: string;
    slotCapacity: number;
    /** As the VPS table shows it; null only for an unchanged VPS that was never onboarded. */
    runnerOnboarding: HostingAdminVpsHost["runnerOnboarding"];
};

/** The control plane's result of `resolve-vps-slot-decommission-kept-slots`: the decommission job was requeued. */
export type HostingResolveVpsSlotDecommissionResult = {
    outcome: "requeued";
    provider: VpsProviderId;
    serviceName: string;
    /** The kept-slot evidence version the resolution was recorded against. */
    evidenceVersion: number;
    runnerOnboarding: NonNullable<HostingAdminVpsHost["runnerOnboarding"]>;
};

export type HostingAdminVpsInventory = {
    liveDataIncluded?: boolean;
    controlPlaneHost: HostingAdminHostResources | null;
    hosts: HostingAdminVpsHost[];
    /** Unregistered account hosts an administrator may onboard; empty when no account read was requested. */
    availableHosts: HostingAdminVpsAvailableHost[];
    /** One entry per enabled provider whose account was read; a failed read withholds only that provider's data. */
    providerReads?: VpsProviderRead[];
    /** Providers without an account API whose hosts are onboarded by manual entry; absent from older backends. Read it through `manualEntryProviders`. */
    manualEntryProviders?: ManualEntryProvider[];
    runnerTargetSourceCommit?: string | null;
};

/** One unregistered provider account host, labelled `<provider display name> · <service name>`. */
export type HostingAdminVpsAvailableHost = {
    provider: VpsProviderId;
    serviceName: string;
    label: string;
};

export type HostingAdminRegionRequest = {
    requestId: string;
    guildId: string;
    discordUserId: string;
    region: string;
    status: "outstanding";
    createdAt: string;
    requesterEmail: string | null;
    allocatedRegions: string[];
    notifiedAt: string | null;
};

/** The outcome of emailing a region requester; `sent` is false when an earlier notification already went out. */
export type HostingAdminRegionRequestNotification = {
    requestId: string;
    notifiedAt: string;
    sent: boolean;
};

export type OperationsData = {
    overview: Pick<Overview, "controls" | "servers" | "jobs" | "stableBuilds" | "nightlyBuilds">;
    inventory: HostingAdminVpsInventory;
    vpsProviderError: string | null;
    selectedServer: ManagedServer | null;
    hostingRegions: HostingRegionCatalogRead;
};

/** One stored entry as `hosting-regions` returns it, with whether it has a free admissible slot now. */
export type HostingAdminRegionEntry = HostingRegionPayload & { available: boolean };

/** The outcome of reading the stored region catalog: its entries, or the message explaining why they are unavailable. */
export type HostingRegionCatalogRead =
    | { regions: HostingAdminRegionEntry[]; error: null }
    | { regions: null; error: string };

/** The VPS view's data: registered hosts and the stored catalog placements that label them (null when unreadable). */
export type VpsViewData = {
    inventory: HostingAdminVpsInventory;
    regionCatalog: HostingRegionPayload[] | null;
};

/** The Relocate view's data: servers, the slots they occupy, the catalog that places hosts in regions, and active jobs. */
export type RelocateViewData = {
    servers: HostingPage<ManagedServer>;
    inventory: HostingAdminVpsInventory;
    regionCatalog: HostingRegionPayload[] | null;
    activeJobs: HostingJob[];
};

export type HostingPlacementWeekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
export type HostingPlacementAlwaysOnTargets = "any" | "single-slot" | "none";
export type HostingPlacementPinReason =
    | "unavailable-state"
    | "no-provider-resource"
    | "no-installed-build"
    | "insufficient-history"
    | "always-on"
    | "no-compatible-host";

/** A recurring weekly UTC window, with its next occurrence. */
export type HostingPlacementWindow = {
    weekday: HostingPlacementWeekday;
    /** `HH:MM` UTC. */
    startsAtUtc: string;
    durationMinutes: number;
    onlineProbability: number;
    nextStartsAt: string;
};

/** Modelled co-tenancy totals; every value is hours per week. */
export type HostingPlacementContention = {
    pairHoursPerWeek: number;
    /** Hours with at least two servers on one VPS online. */
    contendedHoursPerWeek: number;
    /** Hours with at least three servers on one VPS online. */
    saturatedHoursPerWeek: number;
    /** The history window replayed onto the placement, as pair-hours per week. */
    observedPairHoursPerWeek: number;
};

export type HostingPlacementHostSide = HostingPlacementContention & {
    serverIds: string[];
    peakExpectedOnline: number;
};

export type HostingPlacementServer = {
    serverId: string;
    displayName: string;
    region: string;
    serviceName: string;
    proposedServiceName: string;
    pinnedReason: HostingPlacementPinReason | null;
    /** Older control planes omit it; treat a missing value as false. */
    alwaysOn?: boolean;
    observedDays: number;
    weeklyOnlineHours: number;
    /** 168 hourly digits from Monday 00:00 UTC; digit d means online probability in [d/10, (d+1)/10). */
    heatmap: string;
    quietWindow: HostingPlacementWindow;
};

export type HostingPlacementHost = {
    serviceName: string;
    regionKeys: string[];
    vCpu: number;
    slots: number;
    freeSlots: number;
    acceptsRelocations: boolean;
    current: HostingPlacementHostSide;
    proposed: HostingPlacementHostSide;
};

export type HostingPlacementMove = {
    step: number;
    serverId: string;
    displayName: string;
    fromServiceName: string;
    toServiceName: string;
    /** The region to pass to `relocate-server` with this target VPS. */
    targetRegion: string;
    /** A temporary hop into a spare slot that unblocks a cycle of full VPSs. */
    staging: boolean;
    /**
     * Pair-hours only, and depends on step order: one leg of a swap, or a move made for the CPU shortage it removes
     * (control plane #522), can save none on its own.
     */
    gainPairHoursPerWeek: number;
    window: HostingPlacementWindow;
};

/** One current occupant of a shared VPS in the measured overlap. */
export type HostingPlacementOverlapOccupant = {
    serverId: string;
    displayName: string;
    /** Hours of the window with at least one counted sample from this server, wherever it ran then. */
    hoursWithData: number;
};

/** What both shapes of the measured overlap report for one VPS with more than one slot. */
type HostingPlacementOverlapHostMeasure = {
    serviceName: string;
    regionKeys: string[];
    vCpu: number;
    slots: number;
    /** The servers on it now, in slot order; empty for an empty VPS. */
    occupants: HostingPlacementOverlapOccupant[];
    /** 168 hours, oldest first: the sum of the occupants' online fractions, or null when none has data. */
    online: (number | null)[];
    measuredPairHours: number;
    /** Share of the hours in which every occupant has data, 0 to 1. */
    coverage: number;
};

/**
 * One VPS with more than one slot, measured over the window from its current occupants' samples, with how many
 * of its servers can each burst to 1.6 vCPU and 2.5 GiB at once.
 */
export type HostingPlacementOverlapBurstHost = HostingPlacementOverlapHostMeasure & {
    /** The VPS's RAM, or null when the runner's could not be read. */
    memoryBytes: number | null;
    /**
     * min(floor(vCpu / 1.6), floor(memoryBytes / 2.5 GiB)), or floor(vCpu / 1.6) when memoryBytes is null. An older
     * control plane counted floor(vCpu / 2), or 3 GiB per server, never more.
     */
    burstServers: number;
    /**
     * 168 characters, oldest first: `1` more servers online at least half the hour than burstServers, `-` unknown
     * because servers without data could make it more, `0` otherwise. A VPS with no more servers than
     * burstServers is all `0`.
     */
    overBurst: string;
    overBurstHours: number;
    /**
     * From a control plane that fits on typical demand (#550), all three or none: the servers the VPS can run at once
     * (N, the capacity read's `modelledServers`), null while unknown; and `overAtOnce`, encoded as `overBurst` but
     * against N, all `-` while N is null, with its count of `1` hours. The burst fields are then information only.
     */
    atOnceServers?: number | null;
    overAtOnce?: string;
    overAtOnceHours?: number;
};

/** One VPS as a control plane that predates burst capacity (98d1f12a) reports it, with its all-busy verdict. */
export type HostingPlacementOverlapLegacyHost = HostingPlacementOverlapHostMeasure & {
    /** 168 characters, oldest first: `1` full and all busy, `0` full and measured but not all busy, `-` unknown or not full. */
    allBusy: string;
    allBusyHours: number;
};

export type HostingPlacementOverlapHost = HostingPlacementOverlapBurstHost | HostingPlacementOverlapLegacyHost;

/**
 * The `placement-overlap` read: how the current placement was online together, hour by hour, over the last week.
 * Its hosts are all of one shape, burst capacity or legacy, never a mix.
 */
export type HostingAdminPlacementOverlap = {
    generatedAt: string;
    /** The window is [windowStartedAt, windowEndedAt): 168 whole UTC hours ending at the current hour boundary. */
    windowStartedAt: string;
    windowEndedAt: string;
    hours: number;
    hosts: HostingPlacementOverlapHost[];
};

/** Nearest-rank percentiles of the CPU cores one server used, averaged over each interval (about 5 minutes) while it ran. */
export type HostingFleetCapacityCpuCores = { p50: number; p90: number; p95: number; p99: number; max: number };

/** Nearest-rank percentiles of one server's working set at the end of each running interval, in bytes. */
export type HostingFleetCapacityMemoryBytes = { p50: number; p95: number; max: number };

/** What one server needs while it runs, from the 5-minute intervals of the servers it covers; null without data. */
export type HostingFleetCapacityDemand = {
    runningServerHours: number;
    samples: number;
    cpuCores: HostingFleetCapacityCpuCores | null;
    memoryBytes: HostingFleetCapacityMemoryBytes | null;
    /** Share of running time the server's CPU quota throttled it, time-weighted, 0 to 1. */
    throttledShare: number | null;
    /** Share of running time some of the server's tasks waited for CPU (PSI some), time-weighted, 0 to 1. */
    cpuPressureShare: number | null;
};

/** One measure over the window: steal in percent (0–100) or busy cores. */
export type HostingFleetCapacityStat = {
    samples: number;
    mean: number;
    /** The median, no more than `p95`; from a control plane that fits on typical demand (#550) only. */
    p50?: number;
    p95: number;
    max: number;
};

/**
 * A VPS's or an instance type's verdict as a control plane that fits on typical demand (#550) computes it, from the
 * servers it can run at once (N, `modelledServers`), its co-online servers (M) and its slots (S): `unknown` while N is
 * null, `at-risk` by M − N when N < M, `headroom` by N − S when N > S, else `matches`, whose `servers` is 0.
 */
export type HostingFleetCapacityVerdict = { kind: "at-risk" | "headroom" | "matches" | "unknown"; servers: number };

/**
 * Where a VPS's co-online servers come from: `measured` from every current server's online hours; `worst-case-occupants`
 * when some server has too few hours with samples and counts as online in every hour; `slots` when every slot counts:
 * it has no servers, or the control plane could not read the servers' online history (its read then still loads).
 */
export type HostingFleetCapacityConcurrentSource = "measured" | "worst-case-occupants" | "slots";

/**
 * A VPS provider as the fleet capacity read reports it: exactly the control plane's closed `VPS_PROVIDER_IDS`,
 * which include providers whose hosts the website does not manage yet.
 */
export type HostingFleetCapacityProviderId = "ovhcloud-vps" | "contabo-vps" | "hosthatch-vps";

/**
 * Whose per-server demand a VPS is modelled with: the servers that ran on the VPS itself, its instance type's, the
 * fleet's, or none yet. An instance type's is never `vps`.
 */
export type HostingFleetCapacityDemandSource = "vps" | "type" | "fleet" | "none";

export type HostingFleetCapacityProvider = {
    provider: HostingFleetCapacityProviderId;
    hosts: number;
    servers: number;
    demand: HostingFleetCapacityDemand;
    steal: HostingFleetCapacityStat | null;
    busyCores: HostingFleetCapacityStat | null;
};

/** VPSs of one provider with the same vCPUs, whole GiB of RAM, CPU model and clock to 100 MHz. */
export type HostingFleetCapacityInstanceType = {
    /** `provider|vCpu|GiB|cpu model|MHz rounded to 100`, such as `ovhcloud-vps|6|12|Intel Core Processor (Haswell, no TSX)|2400`. */
    key: string;
    provider: HostingFleetCapacityProviderId;
    vCpu: number;
    memoryBytes: number | null;
    cpuModel: string | null;
    cpuMhz: number | null;
    hosts: number;
    servers: number;
    demand: HostingFleetCapacityDemand;
    steal: HostingFleetCapacityStat | null;
    /** How many servers a typical VPS of this type can run at once at their modelled needs. */
    modelledServers: number | null;
    demandSource: HostingFleetCapacityDemandSource;
    /**
     * From a control plane that fits on typical demand (#550), all four or none: vCpu less its pooled steal p50, null
     * without steal; its demand source's p95 cores, null without one; how many could burst at once, information only and
     * null while `modelledServers` is; and its verdict against its static slots, floor(vCpu ÷ 2), as its co-online count.
     */
    effectiveVcpu?: number | null;
    typicalCpuCores?: number | null;
    burstServers?: number | null;
    verdict?: HostingFleetCapacityVerdict;
};

export type HostingFleetCapacityOccupant = {
    serverId: string;
    displayName: string;
    demand: HostingFleetCapacityDemand;
};

export type HostingFleetCapacityHost = {
    serviceName: string;
    provider: HostingFleetCapacityProviderId;
    regionKeys: string[];
    vCpu: number;
    /** From the VPS's latest host sample in the window; null without one. */
    memoryBytes: number | null;
    cpuModel: string | null;
    cpuMhz: number | null;
    /** Null until the VPS's first host sample. */
    instanceTypeKey: string | null;
    /** The VPS's slot capacity: floor(vCpu / 2) when registered, more once an administrator raises it. */
    slots: number;
    occupants: HostingFleetCapacityOccupant[];
    steal: HostingFleetCapacityStat | null;
    busyCores: HostingFleetCapacityStat | null;
    cpuPressureShare: number | null;
    /** The median cores and memory in use beyond the game servers' own. */
    overheadCores: number | null;
    overheadMemoryBytes: number | null;
    /** vCpu × (1 − steal p95 ÷ 100) − overhead cores, and RAM less overhead memory, each clamped at zero. */
    usableCores: number | null;
    usableMemoryBytes: number | null;
    /** A server's stable CPU on this VPS, the median of `demandSource`'s demand; null without a source. */
    stableCpuCores: number | null;
    /** A server's peak CPU on this VPS, the highest interval of `demandSource`'s demand; null without a source. */
    peakCpuCores: number | null;
    /**
     * A server's peak working set on this VPS, the highest interval of `demandSource`'s demand. Null without a source,
     * and from a control plane without a memory burst target.
     */
    peakMemoryBytes: number | null;
    /**
     * The per-server demand this VPS is modelled with, from `demandSource`: each of the model's burst targets, or the
     * peak where that is higher. Without a memory burst target the memory is `demandSource`'s p95.
     */
    demandCpuCores: number | null;
    demandMemoryBytes: number | null;
    demandSource: HostingFleetCapacityDemandSource;
    /** floor(min(usableCores / demandCpuCores, usableMemoryBytes / demandMemoryBytes)); null while an input is unknown. */
    modelledServers: number | null;
    limitedBy: "cpu" | "memory" | null;
    /**
     * From a control plane that fits on typical demand (#550), all of these or none. It then plans `demandCpuCores` at
     * min(2, max(1.6, `typicalCpuCores`)) and `demandMemoryBytes` at min(3 GiB, max(2.5 GiB, peak)); its `usableCores` take off
     * the steal p50, and `modelledServers` is never below the static rule's servers.
     *
     * - `effectiveVcpu`: vCpu × (1 − steal p50 ÷ 100), three decimals; null without steal.
     * - `typicalCpuCores`: the demand source's p95 cores, what a server there usually needs; null without a source.
     * - `burstCpuCores`: min(2, max(1.6, peak)), what one server bursts to; null without a source. Information only.
     * - `burstServers`: how many could burst to it at once; null while `modelledServers` is. Information only.
     * - `concurrentServers`: M, its co-online servers, at most its slots; `concurrentSource` says where M comes from,
     *   and `concurrentCoverage` is the share of the window's hours in which every current server has samples.
     * - `verdict`: N against M and its slots.
     */
    effectiveVcpu?: number | null;
    typicalCpuCores?: number | null;
    burstCpuCores?: number | null;
    burstServers?: number | null;
    concurrentServers?: number;
    concurrentSource?: HostingFleetCapacityConcurrentSource;
    concurrentCoverage?: number;
    verdict?: HostingFleetCapacityVerdict;
    /** Observations taken on this VPS in the window that carried server or host counters. */
    samples: number;
    /** 168 hours oldest first, two lowercase hex digits each or `--` without data: mean steal in permille, capped at 255. */
    stealHourly: string;
    /** 168 hours oldest first, two lowercase hex digits each or `--` without data: mean busy percent of the VPS, 0–100. */
    busyHourly: string;
};

/**
 * The `fleet-capacity` read: what a server needs while it runs, measured over the last week, and how many servers
 * each instance type and each VPS could run at once at those needs, given the CPU the hypervisor steals.
 */
export type HostingAdminFleetCapacity = {
    generatedAt: string;
    /** The window is [windowStartedAt, windowEndedAt), 168 hours long. */
    windowStartedAt: string;
    windowEndedAt: string;
    hours: number;
    model: {
        /** The CPU percentile taken as a server's stable use (50). */
        cpuPercentile: number;
        /** The vCPUs every online server is planned to burst to at once, or its measured peak where that is higher. */
        cpuBurstVcpu: number;
        /**
         * The bytes every online server is planned to burst to at once, or its measured peak where that is higher; null
         * from a control plane without it, which plans memory at `memoryPercentile`.
         */
        memoryBurstBytes: number | null;
        /** The working-set percentile shown beside the plan, and the plan itself while `memoryBurstBytes` is null. */
        memoryPercentile: number;
        /** Running server-hours an instance type, or else the fleet, needs before the model plans with its demand. */
        minimumRunningHours: number;
        staticBurstVcpuPerServer: number;
        staticBurstMemoryBytesPerServer: number;
        /**
         * From a control plane that fits on typical demand (#550), all five or none: the CPU percentile servers are fitted
         * at (95); the steal percentile taken off the vCPUs (50); the steal below which the static floor ignores it (5%);
         * the online share of an hour that counts a server as online in it (0.5); and the share of the window's hours the
         * co-online count may be exceeded in (0.01).
         */
        cpuTypicalPercentile?: number;
        stealPercentile?: number;
        stealFloorThresholdPercent?: number;
        concurrentBusyFraction?: number;
        concurrentHourShare?: number;
    };
    fleet: { hosts: number; servers: number; demand: HostingFleetCapacityDemand };
    providers: HostingFleetCapacityProvider[];
    instanceTypes: HostingFleetCapacityInstanceType[];
    hosts: HostingFleetCapacityHost[];
};

/**
 * Why a VPS's recommended slot count is what it is: `cpu` and `memory`, one more slot would break that budget;
 * `floor`, the most slots that keep both budgets, if any, is below floor(vCPU / 2), but a VPS always keeps that many,
 * so a budget breaks at the floor; `maximum`, the most slots any VPS holds keep both budgets; `drain`, its servers alone break a budget and
 * are more than the floor, so the recommendation is below them; `unmeasured`, its usable cores or memory are neither
 * measured nor borrowable, so there is none.
 */
export type HostingSlotSizingReason = "cpu" | "memory" | "floor" | "maximum" | "drain" | "unmeasured";

/**
 * Where one of a VPS's usable figures for sizing (its cores, or its memory) comes from: its own, borrowed from its
 * instance type or its provider and vCPU count, or none.
 */
export type HostingSlotSizingCapacitySource = "measured" | "type" | "provider-vcpu" | "none";

/**
 * A VPS's slot target as automatic slot sizing stores it: every field null until the sizer first sets one, and
 * `changedAt` and `reason` kept once a target is cleared.
 */
export type HostingSlotSizingTarget = {
    /** The servers sizing wants it to hold, from floor(vCPU / 2) to 32; null means its slots. */
    targetSlots: number | null;
    /** A lower recommendation held for the seven-day shrink: below the target, or its slots without one. */
    pendingLowerSlots: number | null;
    /** When that hold began; set exactly when `pendingLowerSlots` is. */
    pendingLowerSince: string | null;
    /** When the target last changed, and the recommendation's reason then: both or neither, and both with a target. */
    changedAt: string | null;
    reason: string | null;
};

/** One VPS's recommended slot count. */
export type HostingSlotSizingHost = {
    serviceName: string;
    /** A provider id; one the control plane does not know is reported as it is, and is `unmeasured`. */
    provider: string;
    regionKeys: string[];
    vCpu: number;
    /** Its stored slot capacity now. */
    slots: number;
    /** Servers in its slots now. */
    occupants: number;
    /** Whether relocation may move a server onto it: onboarded, with its provider's reviewed image. */
    acceptsRelocations: boolean;
    /** Its usable cores, its own or borrowed; null when neither measured nor borrowable. */
    usableCores: number | null;
    /** Where `usableCores` comes from; `none` exactly when it is null. */
    coresSource: HostingSlotSizingCapacitySource;
    /** Its usable memory, borrowed apart from its cores; null when neither measured nor borrowable. */
    usableMemoryBytes: number | null;
    /** Where `usableMemoryBytes` comes from; `none` exactly when it is null. */
    memorySource: HostingSlotSizingCapacitySource;
    /** The memory each online server is planned to need on it: the memory burst target, or its servers' peak where higher. */
    memoryBytesPerServer: number;
    /** Null only when `unmeasured`; otherwise from floor(vCPU / 2) to the model's `maximumSlots`. */
    recommendedSlots: number | null;
    reason: HostingSlotSizingReason;
    /** Expected CPU shortage, in core-hours a week, of the servers it would hold at the recommendation; three decimals. */
    expectedShortageCoreHoursPerWeek: number | null;
    /** Whether the exact shortage keeps the CPU budget, which the rounded figure cannot tell at the edge; null when `unmeasured`. */
    withinCpuBudget: boolean | null;
    /** Share of the week's hours in which more of them would be online at once than its memory holds; four decimals. */
    memoryOverflowShare: number | null;
    /** Whether the exact share keeps the memory budget (is under it); null when `unmeasured`. */
    withinMemoryBudget: boolean | null;
    /** Servers that would move off it: its servers less the recommendation, for `drain` only. */
    serversToMove: number;
    /** Slots beyond the servers that stay that a moved server could take with both budgets kept. */
    freeRecommendedSlots: number;
    /** Its slot target; a control plane from before automatic slot sizing sends none. */
    target?: HostingSlotSizingTarget;
};

/** One region's moves, room and shortfall under the recommendations. */
export type HostingSlotSizingRegion = {
    regionKey: string;
    /** Servers whose region this is that would move off a drained VPS. */
    serversToMove: number;
    /** Free recommended slots on the region's VPSs that accept relocations. */
    freeRecommendedSlots: number;
    /** Servers to move with no free recommended slot of their own provider in the region: more VPSs are needed. */
    shortfallServers: number;
};

/**
 * The read-only `slot-sizing` recommendation: each VPS's slot count from its servers' weeks and its usable capacity,
 * so servers rarely online together can share a VPS. It changes no capacity, slot, server or placement.
 */
export type HostingAdminSlotSizing = {
    generatedAt: string;
    model: {
        /** The most expected CPU shortage, in core-hours a week, a VPS may have at its recommendation (1). */
        cpuShortageBudgetCoreHoursPerWeek: number;
        /** The share of the week a VPS may have more servers online than its memory holds, kept under (0.01). */
        memoryOverflowShare: number;
        /** What a typical new server is planned to need while online: vCPUs and bytes. */
        cpuBurstVcpu: number;
        memoryBurstBytes: number;
        /** The online history window and its half-life, in days. */
        historyDays: number;
        halfLifeDays: number;
        /** A server observed for less than this counts with the typical new server's week. */
        minimumObservedDays: number;
        /** The most slots any VPS holds (32). */
        maximumSlots: number;
        /** A typical new server's expected online hours a week. */
        typicalWeeklyOnlineHours: number;
        /**
         * What a typical new server is planned to need while online, in cores: at least 1.6, the fleet's p95 where higher, at most 2; 1.6 without
         * fleet data. From a control plane that fits on typical demand (#550) only; `cpuBurstVcpu` is then information.
         */
        typicalServerCpuCores?: number;
        /** Why the capacity samples could not be read, when they could not: every VPS is then `unmeasured`. */
        capacityErrorCode: string | null;
    };
    hosts: HostingSlotSizingHost[];
    regions: HostingSlotSizingRegion[];
};

/** The control plane's read-only `placement-plan` proposal. Nothing is relocated. */
export type HostingAdminPlacementPlan = {
    dryRun: true;
    generatedAt: string;
    options: {
        historyDays: number;
        halfLifeDays: number;
        maximumMoves: number;
        minimumGainHours: number;
        /** Older control planes omit it; they plan as `any`. */
        alwaysOnTargets?: HostingPlacementAlwaysOnTargets;
    };
    model: {
        historyStartedAt: string;
        binMinutes: number;
        timeZone: "UTC";
        minimumObservedDays: number;
        samples: number;
        searchEvaluations: number;
    };
    current: HostingPlacementContention;
    proposed: HostingPlacementContention;
    relocations: number;
    servers: HostingPlacementServer[];
    hosts: HostingPlacementHost[];
    moves: HostingPlacementMove[];
    unsequencedServerIds: string[];
};

export type HostingPlacementAlwaysOnPolicy = "single-slot" | "none" | "any";

/**
 * The automatic placement executor's settings: only `enabled` is a setting, and moves are not rate limited.
 * `updatedAt` is null until an administrator first saves them.
 */
export type HostingPlacementExecutorSettings = {
    enabled: boolean;
    /**
     * Legacy compatibility fields, never shown and only sent back on save as the latest read gave them: control
     * planes before #516 require them (#514 already accepts the cap as optional and ignores it), and #516 and later
     * ignore all four. The rules are fixed now (a gain of 20: pair-hours, plus 20 per core-hour of CPU shortage removed
     * from #522; an hour's notice; one-slot VPSs).
     */
    maximumRelocationsPerDay?: number;
    minimumGainHours?: number;
    alwaysOnPolicy?: HostingPlacementAlwaysOnPolicy;
    noticeLeadHours?: number;
    updatedBy: string | null;
    reason: string | null;
    updatedAt: string | null;
};

/** One automatic relocation: `offline` moves a stopped server at once, `announced` notifies the owner first. */
export type HostingPlacementRelocation = {
    relocationId: string;
    serverId: string;
    displayName: string;
    fromServiceName: string;
    toServiceName: string;
    targetRegion: string;
    mode: "offline" | "announced";
    state: "announced" | "queued" | "succeeded" | "failed" | "cancelled";
    gainPairHoursPerWeek: number;
    scheduledAt: string;
    announcementNoticeId: string | null;
    completionNoticeId: string | null;
    jobId: string | null;
    errorCode: string | null;
    createdAt: string;
    queuedAt: string | null;
    updatedAt: string;
    completedAt: string | null;
    /** The move's job as administrators follow it live; older control planes omit it. */
    progress?: HostingPlacementRelocationProgress;
};

/** A relocation job's steps, in the order it runs them. */
export type HostingPlacementMoveStep = "preparing" | "saving-and-stopping" | "backing-up" | "restoring" | "switching-address" | "starting-game" | "finishing";

/** One in-game warning of an announced move: queued, running or retry-wait until it goes out. */
export type HostingPlacementRelocationWarning = {
    minutes: 60 | 10;
    state: "queued" | "running" | "retry-wait" | "succeeded" | "unsupported" | "failed";
    /** Set only once the game received it. */
    sentAt: string | null;
};

export type HostingPlacementRelocationProgress = {
    /** The job's current step; null without a job, once it finished or while it puts the server back. */
    step: HostingPlacementMoveStep | null;
    /** True while the unfinished job puts the server back on its original VPS after a failure; older control planes omit it. */
    returning?: boolean;
    /** Each step the job reached, in step order, with the first time it reached it. */
    steps: { step: HostingPlacementMoveStep; reachedAt: string }[];
    jobState: "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled" | null;
    jobStartedAt: string | null;
    jobCompletedAt: string | null;
    /** Whether the move starts the game on the new VPS: only when it was running as the job began; null without a job. */
    restartsGame: boolean | null;
    /** An announced move's in-game warnings, 60 minutes first; empty for an offline move. */
    warnings: HostingPlacementRelocationWarning[];
};

/** A server the executor leaves alone until `until`, because its latest automatic move failed or was cancelled. */
export type HostingPlacementBackoff = {
    serverId: string;
    relocationId: string;
    until: string;
    errorCode: string | null;
};

/** The `placement-executor` read: current settings, what it is doing and the 50 newest automatic relocations. */
export type HostingAdminPlacementExecutor = {
    settings: HostingPlacementExecutorSettings;
    /** Older control planes omit it. */
    status?: {
        /** The announced or queued relocation; the executor runs one at a time. */
        activeRelocationId: string | null;
        /** Relocations queued in the last 24 hours. Informational: moves are not rate limited. */
        queuedInLast24Hours: number;
        /** Servers not moved automatically until `until` after a failed or cancelled move, newest first; older control planes omit it. */
        backedOff?: HostingPlacementBackoff[];
    };
    relocations: HostingPlacementRelocation[];
};

export type HostingServerNoticeKind = "administrator" | "placement-scheduled" | "placement-completed";
export type HostingServerNoticeSeverity = "info" | "warning";

/** A server notice as administrators list it, with at most 20 of its target servers. */
export type HostingAdminNotice = {
    noticeId: string;
    kind: HostingServerNoticeKind;
    severity: HostingServerNoticeSeverity;
    title: string;
    body: string;
    parameters: Record<string, unknown>;
    createdAt: string;
    expiresAt: string | null;
    state: "active" | "expired" | "withdrawn";
    createdBy: string;
    reason: string | null;
    withdrawnAt: string | null;
    targetCount: number;
    dismissalCount: number;
    servers: { serverId: string; displayName: string }[];
};

/** The outcome of `create-notice`; a replayed request ID returns the first notice as `existing`. */
export type HostingAdminNoticeCreation = { outcome: "created" | "existing"; notice: HostingAdminNotice };

/** The Notices view's data: the first page of servers that a notice can target. */
export type NoticesViewData = { servers: HostingPage<ManagedServer> };

/** The Placement view's data: the slots servers occupy, the catalog that places hosts in regions, and active jobs. The plan itself loads on demand. */
export type PlacementViewData = {
    inventory: HostingAdminVpsInventory;
    regionCatalog: HostingRegionPayload[] | null;
    activeJobs: HostingJob[];
};

export type FleetSummary = {
    entitledUsers: number;
    totalEffectiveQuota: number;
    usedQuota: number;
    managedVpsCount: number;
    totalSlots: number;
    availableSlots: number;
    running: number;
    stopped: number;
    provisioning: number;
    failedOrDegraded: number;
    suspended: number;
    pendingDeletion: number;
    activeJobs: number;
    stuckJobs: number;
    backupFailures: number;
    agentHealthy: number;
    agentUnhealthyOrUnknown: number;
    crashLooping: number;
    lastReconciledAt: string | null;
    provider: {
        mode: string;
        apiHealth: string;
        capacityAvailable: boolean;
        managedInstanceCount: number | null;
        ambiguousResourceCount: number;
        missingInstanceCount: number;
        mismatchedInstanceCount: number;
        observedAt: string;
    };
    observability: {
        recentWindowSeconds: number;
        recentJobFailures: number;
        recentProviderApiErrors: number;
        recentBackupFailures: number;
        overdueBackups: number | null;
    };
};

export type GlobalControls = {
    provisioningPaused: boolean;
    maintenancePaused: boolean;
    automaticBackupsPaused: boolean;
    nightlyRolloutsPaused: boolean;
    updatedBy: string | null;
    reason: string | null;
    updatedAt: string | null;
};

export type Overview = {
    health: Record<string, unknown>;
    fleet: FleetSummary;
    controls: GlobalControls;
    servers: HostingPage<ManagedServer>;
    jobs: HostingPage<HostingJob>;
    stableBuilds: HostingPage<ReleaseBuild>;
    nightlyBuilds: HostingPage<ReleaseBuild>;
};

/** Current data rendered by the Overview pane, without unused detail reads. */
export type OverviewSummary = Pick<Overview, "fleet" | "controls" | "jobs">;

export type ServerDashboardResult = {
    dashboard: {
        server: ManagedServer;
        runtime: {
            agentHealthy: boolean;
            playerCount: number | null;
            uptimeSeconds: number | null;
            diskUsedBytes: number | null;
            diskFreeBytes: number | null;
            lastBackupAt: string | null;
            crashLoopDetected: boolean;
            observedAt: string;
        } | null;
        installedBuild: ReleaseBuild | null;
        desiredBuild: ReleaseBuild | null;
        activeSave: { saveId: string; displayName: string; detectedVersion: string | null } | null;
        activeJob: HostingJobProgress | null;
        nextMaintenanceAt: string;
    };
    backups: HostingPage<Backup>;
    audit: HostingPage<AuditEvent>;
};
