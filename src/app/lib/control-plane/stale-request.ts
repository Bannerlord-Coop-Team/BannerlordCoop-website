import { ControlPlaneAdminError, requestControlPlaneAdmin } from "./client";

// These workflows reject stale generations before accepting a job. Do not add
// direct commands or exact-attempt job mutations to this list.
const REPLAYABLE_SERVER_OPERATIONS = new Set([
    "server-operation", "update-server", "rollback-server", "restore-backup", "collect-diagnostics",
]);

export async function requestControlPlaneAdminWithRefresh(
    options: { accessToken: string; requestId: string; operation: string; input?: Record<string, unknown> },
    refresh: () => void,
): Promise<unknown> {
    try {
        return await requestControlPlaneAdmin(options);
    } catch (error) {
        if (!(error instanceof ControlPlaneAdminError) || error.code !== "stale_interaction"
            || error.requestId !== options.requestId) throw error;
        try {
            const input = options.input;
            if (error.operationId !== undefined || !REPLAYABLE_SERVER_OPERATIONS.has(options.operation) || !input
                || typeof input.serverId !== "string" || typeof input.expectedUpdatedAt !== "string") throw error;
            const current = await requestControlPlaneAdmin<{ dashboard?: { server?: { serverId?: string; updatedAt?: string } } }>({
                accessToken: options.accessToken,
                operation: "server-dashboard",
                input: { serverId: input.serverId },
            });
            const server = current?.dashboard?.server;
            if (server?.serverId !== input.serverId || typeof server.updatedAt !== "string"
                || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(server.updatedAt)
                || !Number.isFinite(Date.parse(server.updatedAt)) || server.updatedAt === input.expectedUpdatedAt) throw error;
            // One replay, outside the first attempt's catch. Keep the durable UUID
            // and every user-selected field; only replace the concurrency token.
            return await requestControlPlaneAdmin({
                ...options, input: { ...input, expectedUpdatedAt: server.updatedAt },
            });
        } finally {
            refresh();
        }
    }
}
