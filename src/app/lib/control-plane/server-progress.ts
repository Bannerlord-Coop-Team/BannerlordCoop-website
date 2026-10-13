import type { HostingJobProgress, ReleaseBuild, ServerDashboardResult } from "./types";

/** Keep private dashboard fields out of the server-rendered client props and retained display state. */
export function serverProgressView(result: ServerDashboardResult) {
    const { dashboard } = result;
    const { serverId, ownerDiscordUserId, ownerAccountId, displayName, provider, providerResourceId, friendlyRegion,
        desiredState, observedVmState, observedGameState, operationState, releaseChannel, installedBuildId,
        desiredBuildId, pinnedBuildId, updatedAt } = dashboard.server;
    const job = dashboard.activeJob;
    const activeJob: HostingJobProgress | null = job === null ? null : {
        jobId: job.jobId, serverId: job.serverId, action: job.action, state: job.state,
        progressStage: job.progressStage, errorCode: job.errorCode, attemptCount: job.attemptCount,
        maximumAttempts: job.maximumAttempts, updatedAt: job.updatedAt,
    };
    return {
        dashboard: {
            server: { serverId, ownerDiscordUserId, ownerAccountId, displayName, provider, providerResourceId, friendlyRegion,
                desiredState, observedVmState, observedGameState, operationState, releaseChannel, installedBuildId,
                desiredBuildId, pinnedBuildId, updatedAt },
            activeJob,
            runtime: dashboard.runtime === null ? null : { agentHealthy: dashboard.runtime.agentHealthy },
            installedBuild: displayBuild(dashboard.installedBuild), desiredBuild: displayBuild(dashboard.desiredBuild),
            activeSave: dashboard.activeSave === null ? null : { displayName: dashboard.activeSave.displayName },
        },
        backups: { items: result.backups.items.map(({ backupId, serverId, backupType, byteSize, buildId, saveId,
            retentionExpiresAt, createdAt, restoreState, lastErrorCode }) => ({ backupId, serverId, backupType, byteSize,
            buildId, saveId, retentionExpiresAt, createdAt, restoreState, lastErrorCode })) },
        audit: { items: result.audit.items.map(({ eventId, actorType, actorId, targetDiscordUserId, targetServerId,
            action, reason, correlationId, occurredAt }) => ({ eventId, actorType, actorId, targetDiscordUserId,
            targetServerId, action, reason, correlationId, occurredAt })) },
    };
}
export type ServerProgressView = ReturnType<typeof serverProgressView>;

function displayBuild(build: ReleaseBuild | null): ReleaseBuild | null {
    if (build === null) return null;
    const { buildId, channel, version, sourceRevision, supportedGameVersion, validationState, publishedAt,
        updatedAt, requiredClientModVersion, registryMetadata } = build;
    return { buildId, channel, version, sourceRevision, supportedGameVersion, validationState, publishedAt,
        updatedAt, requiredClientModVersion, ...(registryMetadata ? { registryMetadata: {
            versionTag: registryMetadata.versionTag, clientRevision: registryMetadata.clientRevision,
            serverRevision: registryMetadata.serverRevision,
        } } : {}) };
}
