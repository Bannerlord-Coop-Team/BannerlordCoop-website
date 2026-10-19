import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";
import type { VpsProviderId, VpsProviderRead } from "./vps-providers";

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
    /** Depends on step order; one leg of a swap can save nothing on its own. */
    gainPairHoursPerWeek: number;
    window: HostingPlacementWindow;
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

/** The automatic placement executor's settings; `updatedAt` is null until an administrator first saves them. */
export type HostingPlacementExecutorSettings = {
    enabled: boolean;
    maximumRelocationsPerDay: number;
    minimumGainHours: number;
    alwaysOnPolicy: HostingPlacementAlwaysOnPolicy;
    noticeLeadHours: number;
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
};

/** The `placement-executor` read: current settings and the 50 newest automatic relocations. */
export type HostingAdminPlacementExecutor = {
    settings: HostingPlacementExecutorSettings;
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
