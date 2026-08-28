export type ManagedServer = {
    serverId: string;
    ownerDiscordUserId: string;
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

export type HostingAdminVpsHost = {
    name: string;
    locationId: string;
    region: string;
    totalSlots: number;
    runningServers: number;
    availableServers: number;
    cost: {
        priceInMicrocents: number;
        currencyCode: string;
        duration: string;
        interval: number;
    } | null;
    expirationDate: string | null;
    autoRenew: boolean | null;
    providerCheckedAt: string | null;
    runnerOnboarding: {
        state: "queued" | "running" | "retry-wait" | "succeeded" | "failed";
        progressStage: string;
        errorCode: string | null;
        sourceCommit: string | null;
        updatedAt: string;
    } | null;
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
    roleDeletionsPaused: boolean;
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
