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
    name: string;
    locationId: string;
    // Provider-reported ISO country; null only for a retained legacy host without one.
    countryCode: string | null;
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
    availableServiceNames: string[];
    runnerTargetSourceCommit?: string | null;
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
};

export type OperationsData = {
    overview: Pick<Overview, "controls" | "servers" | "jobs" | "stableBuilds" | "nightlyBuilds">;
    inventory: HostingAdminVpsInventory;
    vpsProviderError: string | null;
    selectedServer: ManagedServer | null;
    // The control plane's stored region catalog; null with an error when it could not be read.
    hostingRegions: HostingAdminRegionCatalog | null;
    hostingRegionsError: string | null;
};

/** Hosts eligible for a region: ISO country codes, optionally narrowed to exact provider zones. */
export type HostingAdminRegionPlacement = { countryCodes: string[]; locationIds?: string[] };

/** One stored catalog entry, as `hosting-regions` returns and `set-hosting-regions` accepts it. */
export type HostingAdminRegionDefinition = { region: string; placement: HostingAdminRegionPlacement };

/** The control plane's stored region catalog (`hosting-regions`, and the result of `set-hosting-regions`). */
export type HostingAdminRegionCatalog = {
    revision: number;
    regions: HostingAdminRegionDefinition[];
    updatedAt: string | null;
    updatedBy: string | null;
};

/** Input for `set-hosting-regions`: the full ordered catalog, guarded by the revision it replaces. */
export type HostingAdminSetRegionsInput = {
    expectedRevision: number;
    regions: HostingAdminRegionDefinition[];
    reason: string;
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
        orphanCandidateCount: number;
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
        activeJob: HostingJob | null;
        nextMaintenanceAt: string;
    };
    backups: HostingPage<Backup>;
    audit: HostingPage<AuditEvent>;
};
