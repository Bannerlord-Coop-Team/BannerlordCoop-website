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
 * of its servers can each burst to 1.6 vCPU and 3 GiB at once.
 */
export type HostingPlacementOverlapBurstHost = HostingPlacementOverlapHostMeasure & {
    /** The VPS's RAM, or null when the runner's could not be read. */
    memoryBytes: number | null;
    /**
     * min(floor(vCpu / 1.6), floor(memoryBytes / 3 GiB)), or floor(vCpu / 1.6) when memoryBytes is null. An older
     * control plane counted floor(vCpu / 2), never more.
     */
    burstServers: number;
    /**
     * 168 characters, oldest first: `1` more servers online at least half the hour than burstServers, `-` unknown
     * because servers without data could make it more, `0` otherwise. A VPS with no more servers than
     * burstServers is all `0`.
     */
    overBurst: string;
    overBurstHours: number;
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
export type HostingFleetCapacityStat = { samples: number; mean: number; p95: number; max: number };

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
    /** Today's static slots: floor(vCpu / 2). */
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
    /**
     * A server's stable CPU on this VPS, the median of `demandSource`'s demand. Null without a source, and from an
     * older control plane that planned for a percentile.
     */
    stableCpuCores: number | null;
    /** A server's peak CPU on this VPS, the highest interval of `demandSource`'s demand; null as `stableCpuCores` is. */
    peakCpuCores: number | null;
    /**
     * The per-server demand this VPS is modelled with, from `demandSource`: the model's burst target, or the peak where
     * that is higher.
     */
    demandCpuCores: number | null;
    demandMemoryBytes: number | null;
    demandSource: HostingFleetCapacityDemandSource;
    /** floor(min(usableCores / demandCpuCores, usableMemoryBytes / demandMemoryBytes)); null while an input is unknown. */
    modelledServers: number | null;
    limitedBy: "cpu" | "memory" | null;
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
        /** The CPU percentile taken as a server's stable use (50); an older control plane planned for it directly. */
        cpuPercentile: number;
        /**
         * The vCPUs every online server is planned to burst to at once, or its measured peak where that is higher;
         * null from an older control plane, which planned for `cpuPercentile` without it.
         */
        cpuBurstVcpu: number | null;
        memoryPercentile: number;
        /** Running server-hours an instance type, or else the fleet, needs before the model plans with its demand. */
        minimumRunningHours: number;
        staticBurstVcpuPerServer: number;
        staticBurstMemoryBytesPerServer: number;
    };
    fleet: { hosts: number; servers: number; demand: HostingFleetCapacityDemand };
    providers: HostingFleetCapacityProvider[];
    instanceTypes: HostingFleetCapacityInstanceType[];
    hosts: HostingFleetCapacityHost[];
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
