import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { WebSocket } from "ws";
import { loadServerConfigurations } from "./config.mjs";
import { assertContainerIdentityAndIsolation } from "./container-policy.mjs";
const MAX_OUTPUT_CHUNK_BYTES = 48 * 1024;
const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
const CONTAINER_OPERATIONS = new Set(["start", "stop", "restart", "update"]);

function required(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function positiveInteger(name, fallback, maximum) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
    }
    return value;
}

function validateGatewayUrl(value) {
    const url = new URL(value);
    const insecureAllowed = process.env.ALLOW_INSECURE_CONSOLE_GATEWAY === "true";
    if (url.protocol !== "wss:" && !(insecureAllowed && url.protocol === "ws:")) {
        throw new Error("CONSOLE_GATEWAY_NODE_URL must use wss:// (or explicitly enable insecure local development).");
    }
    if (url.username || url.password || url.hash) {
        throw new Error("CONSOLE_GATEWAY_NODE_URL must not contain credentials or a fragment.");
    }
    return url.toString();
}

function log(event, details = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...details,
    }));
}

function parseMessage(data) {
    try {
        return JSON.parse(data.toString());
    } catch {
        return null;
    }
}

function send(socket, message) {
    if (socket?.readyState !== WebSocket.OPEN) return false;

    const payload = JSON.stringify(message);
    if (socket.bufferedAmount + Buffer.byteLength(payload) > MAX_WS_BUFFERED_BYTES) {
        return false;
    }
    socket.send(payload);
    return true;
}

const gatewayUrl = validateGatewayUrl(required("CONSOLE_GATEWAY_NODE_URL"));
const nodeToken = required("CONSOLE_NODE_TOKEN");
if (nodeToken.length < 32) throw new Error("CONSOLE_NODE_TOKEN must contain at least 32 characters.");

const nodeId = process.env.CONSOLE_NODE_ID?.trim() || "vps-15-204-120-17";
const servers = loadServerConfigurations();
const tailLines = positiveInteger("CONSOLE_TAIL_LINES", 500, 10_000);
const stopTimeoutSeconds = positiveInteger("CONTAINER_STOP_TIMEOUT_SECONDS", 60, 300);
const updateReadinessTimeoutSeconds = positiveInteger(
    "CONTAINER_UPDATE_READINESS_TIMEOUT_SECONDS",
    300,
    600,
);
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });
const sessions = new Map();
const closedSessionIds = new Set();
const operationsInProgress = new Set();
let activeSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let stopping = false;

function streamOutput(socket, sessionId, stream, chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (let offset = 0; offset < buffer.length; offset += MAX_OUTPUT_CHUNK_BYTES) {
        const frame = buffer.subarray(offset, offset + MAX_OUTPUT_CHUNK_BYTES);
        if (!send(socket, {
            type: "output",
            sessionId,
            stream,
            data: frame.toString("base64"),
        })) {
            return false;
        }
    }
    return true;
}

function rememberClosedSession(sessionId) {
    closedSessionIds.add(sessionId);
    if (closedSessionIds.size > 1000) {
        closedSessionIds.delete(closedSessionIds.values().next().value);
    }
}

function closeSession(sessionId, message, notifyGateway = true) {
    const session = sessions.get(sessionId);
    if (!session || session.closing) return;
    session.closing = true;
    sessions.delete(sessionId);

    for (const stream of [
        session.input,
        session.output,
        session.stdout,
        session.stderr,
    ]) {
        stream?.destroy();
    }

    if (notifyGateway) {
        send(session.socket, { type: "closed", sessionId, message });
    }
    log("container_session_closed", { sessionId, serverId: session.serverId, message });
}

function closeServerSessions(serverId, message) {
    for (const [sessionId, session] of sessions) {
        if (session.serverId === serverId) closeSession(sessionId, message);
    }
}

function sendContainerState(socket, sessionId, state, message, serverId) {
    send(socket, {
        type: "containerState",
        sessionId,
        state,
        ...(serverId ? { serverId } : {}),
        ...(message ? { message } : {}),
    });
}

function sendOperationResult(socket, sessionId, operation, ok, message, serverId) {
    send(socket, {
        type: "operationResult",
        sessionId,
        serverId,
        operation,
        ok,
        message: message.slice(0, 300),
    });
}

function assertUpdateConfiguration(inspection, imageInspection, server) {
    assertContainerIdentityAndIsolation(inspection, server);
    const config = inspection.Config ?? {};
    const imageConfig = imageInspection.Config ?? {};
    const host = inspection.HostConfig ?? {};
    const inheritedConfigKeys = [
        "Cmd",
        "Entrypoint",
        "Env",
        "Healthcheck",
        "Labels",
        "StopSignal",
        "User",
        "WorkingDir",
    ];
    const unsupportedOverride = inheritedConfigKeys.find((key) => {
        const containerValue = ["Cmd", "Entrypoint"].includes(key)
            ? config[key] ?? []
            : key === "Labels"
                ? config[key] ?? {}
                : ["StopSignal", "User", "WorkingDir"].includes(key)
                    ? config[key] ?? ""
                    : key === "Healthcheck"
                        ? config[key] ?? null
                        : config[key];
        const imageValue = ["Cmd", "Entrypoint"].includes(key)
            ? imageConfig[key] ?? []
            : key === "Labels"
                ? imageConfig[key] ?? {}
                : ["StopSignal", "User", "WorkingDir"].includes(key)
                    ? imageConfig[key] ?? ""
                    : key === "Healthcheck"
                        ? imageConfig[key] ?? null
                        : imageConfig[key];
        return !isDeepStrictEqual(containerValue, imageValue);
    });
    if (unsupportedOverride) {
        throw new Error(`Update refused because the container overrides ${unsupportedOverride}.`);
    }

    const supportedSecurity =
        host.Privileged === false &&
        host.ReadonlyRootfs === false &&
        host.AutoRemove === false &&
        host.NetworkMode === "bridge" &&
        host.RestartPolicy?.Name === "unless-stopped" &&
        isDeepStrictEqual(host.CapDrop ?? [], ["ALL"]) &&
        isDeepStrictEqual(host.SecurityOpt ?? [], ["no-new-privileges:true"]);
    const unsupportedHostCustomization =
        host.Binds ||
        host.CapAdd ||
        host.CpuShares ||
        host.Devices?.length ||
        host.Dns?.length ||
        host.ExtraHosts?.length ||
        host.Memory ||
        host.NanoCpus ||
        host.PidsLimit ||
        host.Sysctls ||
        host.Tmpfs ||
        host.Ulimits?.length;

    if (!supportedSecurity || unsupportedHostCustomization) {
        throw new Error("Update refused because the container does not match the supported Bannerlord deployment specification.");
    }
}

function replacementOptions(inspection, image, name, server) {
    const host = inspection.HostConfig;
    const port = `${server.udpPort}/udp`;
    return {
        name,
        Image: image,
        AttachStdin: true,
        ExposedPorts: { [port]: {} },
        OpenStdin: true,
        StdinOnce: false,
        Tty: false,
        HostConfig: {
            AutoRemove: false,
            CapDrop: ["ALL"],
            LogConfig: host.LogConfig,
            Mounts: [{
                Type: "volume",
                Source: server.dataVolume,
                Target: server.dataPath,
                ReadOnly: false,
            }],
            NetworkMode: "bridge",
            PortBindings: { [port]: host.PortBindings[port] },
            Privileged: false,
            PublishAllPorts: false,
            ReadonlyRootfs: false,
            RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
            SecurityOpt: ["no-new-privileges:true"],
            ShmSize: host.ShmSize,
        },
    };
}

async function pullImage(image) {
    const stream = await docker.pull(image);
    await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
    return docker.getImage(image).inspect();
}

async function waitForReplacementReadiness(container, startedAtSeconds, readinessPattern) {
    const deadline = Date.now() + updateReadinessTimeoutSeconds * 1000;
    while (Date.now() < deadline) {
        const inspection = await container.inspect();
        if (!inspection.State?.Running) {
            throw new Error(
                `The replacement container exited with code ${inspection.State?.ExitCode ?? "unknown"}.`,
            );
        }
        if (inspection.State.Health?.Status === "unhealthy") {
            throw new Error("The replacement container health check became unhealthy.");
        }

        const logs = await container.logs({
            stdout: true,
            stderr: true,
            since: startedAtSeconds,
            tail: 500,
        });
        if (logs.toString("utf8").includes(readinessPattern)) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("The replacement container did not reach the configured readiness marker in time.");
}

async function updateContainer(socket, serverId, sessionId, server) {
    if (!server.updateImage) {
        throw new Error("No update image is configured for this server.");
    }

    sendContainerState(socket, sessionId, "updating", "Pulling the configured update image…", serverId);
    const configuredContainer = docker.getContainer(server.container);
    const inspection = await configuredContainer.inspect();
    assertContainerIdentityAndIsolation(inspection, server);
    // Keep a stable ID handle across renames during the update transaction.
    const container = docker.getContainer(inspection.Id);
    const imageInspection = await pullImage(server.updateImage);

    if (inspection.Image === imageInspection.Id) {
        sendContainerState(
            socket,
            sessionId,
            inspection.State?.Running ? "running" : "stopped",
            undefined,
            serverId,
        );
        return "The server image is already up to date.";
    }

    const originalName = inspection.Name.replace(/^\//, "");
    const rollbackName = `${originalName}-pre-update-${Date.now()}`;
    const failedReplacementName = `${originalName}-failed-update-${Date.now()}`;
    const wasRunning = Boolean(inspection.State?.Running);
    const oldImageInspection = await docker.getImage(inspection.Image).inspect();
    assertUpdateConfiguration(inspection, oldImageInspection, server);
    closeServerSessions(serverId, "The container is being updated.");

    let originalStopped = false;
    let originalRenamed = false;
    let replacement = null;
    let replacementOwnsProductionName = false;

    try {
        if (wasRunning) {
            await container.stop({ t: stopTimeoutSeconds });
            originalStopped = true;
            const stoppedInspection = await container.inspect();
            if (stoppedInspection.State?.Running) {
                throw new Error("Docker did not stop the existing container.");
            }
        }

        await container.rename({ name: rollbackName });
        originalRenamed = true;
        replacement = await docker.createContainer(
            replacementOptions(inspection, server.updateImage, originalName, server),
        );
        replacementOwnsProductionName = true;

        if (wasRunning) {
            const startedAtSeconds = Math.floor(Date.now() / 1000);
            await replacement.start();
            await waitForReplacementReadiness(
                replacement,
                startedAtSeconds,
                server.readinessPattern,
            );
        }

        const replacementInspection = await replacement.inspect();
        const replacementName = replacementInspection.Name?.replace(/^\//, "");
        if (
            replacementName !== originalName ||
            (wasRunning && !replacementInspection.State?.Running)
        ) {
            throw new Error("The replacement container failed post-update verification.");
        }
    } catch (error) {
        const recoveryErrors = [];

        if (replacement) {
            try {
                const replacementInspection = await replacement.inspect();
                if (replacementInspection.State?.Running) {
                    await replacement.stop({ t: Math.min(stopTimeoutSeconds, 15) });
                }
            } catch (cleanupError) {
                recoveryErrors.push(`replacement stop: ${cleanupError instanceof Error ? cleanupError.message : "unknown error"}`);
            }

            if (replacementOwnsProductionName) {
                try {
                    await replacement.rename({ name: failedReplacementName });
                    replacementOwnsProductionName = false;
                } catch (renameError) {
                    try {
                        await replacement.remove({ force: true });
                        replacementOwnsProductionName = false;
                    } catch (removeError) {
                        recoveryErrors.push(
                            `replacement quarantine: ${renameError instanceof Error ? renameError.message : "rename failed"}; removal: ${removeError instanceof Error ? removeError.message : "remove failed"}`,
                        );
                    }
                }
            }
        }

        if (originalRenamed && !replacementOwnsProductionName) {
            try {
                await container.rename({ name: originalName });
                originalRenamed = false;
            } catch (renameError) {
                recoveryErrors.push(`original rename: ${renameError instanceof Error ? renameError.message : "unknown error"}`);
            }
        }

        if (wasRunning && !originalRenamed && !replacementOwnsProductionName) {
            try {
                const originalInspection = await container.inspect();
                if (!originalInspection.State?.Running) {
                    const restoredStartedAtSeconds = Math.floor(Date.now() / 1000);
                    await container.start();
                    await waitForReplacementReadiness(
                        container,
                        restoredStartedAtSeconds,
                        server.readinessPattern,
                    );
                } else if (originalStopped) {
                    const recentStart = Math.floor(
                        new Date(originalInspection.State.StartedAt).getTime() / 1000,
                    );
                    await waitForReplacementReadiness(
                        container,
                        recentStart,
                        server.readinessPattern,
                    );
                }
            } catch (startError) {
                recoveryErrors.push(`original readiness: ${startError instanceof Error ? startError.message : "unknown error"}`);
            }
        }

        try {
            const restored = await container.inspect();
            const restoredName = restored.Name?.replace(/^\//, "");
            if (
                restoredName !== originalName ||
                (wasRunning && !restored.State?.Running) ||
                replacementOwnsProductionName
            ) {
                recoveryErrors.push("restored container verification failed");
            }
        } catch (verificationError) {
            recoveryErrors.push(`restored container inspection: ${verificationError instanceof Error ? verificationError.message : "unknown error"}`);
        }

        const operationError = error instanceof Error ? error.message : "unknown Docker error";
        if (recoveryErrors.length > 0) {
            throw new Error(
                `UPDATE FAILED AND AUTOMATIC RECOVERY FAILED: ${operationError}. Recovery errors: ${recoveryErrors.join("; ")}`,
            );
        }
        throw new Error(
            `The update failed and the previous container was verified as restored: ${operationError}${originalStopped ? "" : " (the original stop did not complete)"}`,
        );
    }

    sendContainerState(socket, sessionId, wasRunning ? "running" : "stopped", undefined, serverId);
    return `Updated the server image and passed readiness checks. Rollback container retained as ${rollbackName}.`;
}

async function executeOperation(socket, message) {
    const { operation, serverId, sessionId } = message;
    const server = servers.get(serverId);
    if (!server || !CONTAINER_OPERATIONS.has(operation)) {
        sendOperationResult(socket, sessionId, operation, false, "Invalid server operation.", serverId);
        return;
    }
    if (operationsInProgress.has(serverId)) {
        sendOperationResult(socket, sessionId, operation, false, "Another server operation is already running.", serverId);
        return;
    }

    operationsInProgress.add(serverId);
    const container = docker.getContainer(server.container);
    try {
        if (operation === "stop") {
            const inspection = await container.inspect();
            assertContainerIdentityAndIsolation(inspection, server);
            sendContainerState(socket, sessionId, "stopping", undefined, serverId);
            closeServerSessions(serverId, "The container is stopping.");
            if (inspection.State?.Running) await container.stop({ t: stopTimeoutSeconds });
            sendContainerState(socket, sessionId, "stopped", undefined, serverId);
            sendOperationResult(socket, sessionId, operation, true, "Server stopped.", serverId);
            return;
        }

        if (operation === "start") {
            const inspection = await container.inspect();
            assertContainerIdentityAndIsolation(inspection, server);
            sendContainerState(socket, sessionId, "starting", undefined, serverId);
            if (!inspection.State?.Running) await container.start();
            sendContainerState(socket, sessionId, "running", undefined, serverId);
            sendOperationResult(socket, sessionId, operation, true, "Server started.", serverId);
            return;
        }

        if (operation === "restart") {
            const inspection = await container.inspect();
            assertContainerIdentityAndIsolation(inspection, server);
            sendContainerState(socket, sessionId, "restarting", undefined, serverId);
            closeServerSessions(serverId, "The container is restarting.");
            if (inspection.State?.Running) await container.restart({ t: stopTimeoutSeconds });
            else await container.start();
            sendContainerState(socket, sessionId, "running", undefined, serverId);
            sendOperationResult(socket, sessionId, operation, true, "Server restarted.", serverId);
            return;
        }

        const result = await updateContainer(
            socket,
            serverId,
            sessionId,
            server,
        );
        sendOperationResult(socket, sessionId, operation, true, result, serverId);
    } catch (error) {
        const errorMessage = error instanceof Error
            ? error.message.slice(0, 300)
            : "The Docker operation failed.";
        try {
            const inspection = await docker.getContainer(server.container).inspect();
            assertContainerIdentityAndIsolation(inspection, server);
            sendContainerState(
                socket,
                sessionId,
                inspection.State?.Running ? "running" : "stopped",
                undefined,
                serverId,
            );
        } catch {
            sendContainerState(socket, sessionId, "error", errorMessage, serverId);
        }
        sendOperationResult(socket, sessionId, operation, false, errorMessage, serverId);
        log("container_operation_failed", { serverId, operation, message: errorMessage });
    } finally {
        operationsInProgress.delete(serverId);
    }
}

async function attachSession(socket, message) {
    const { serverId, sessionId } = message;
    if (closedSessionIds.has(sessionId)) return;

    const server = servers.get(serverId);
    if (!server) {
        send(socket, { type: "error", sessionId, message: "This server is not allowlisted on the node agent." });
        return;
    }
    if (
        sessions.has(sessionId) ||
        [...sessions.values()].some((session) => session.serverId === serverId)
    ) {
        send(socket, { type: "error", sessionId, message: "This container already has a console session." });
        return;
    }

    const session = {
        closing: false,
        input: null,
        output: null,
        pending: true,
        serverId,
        socket,
        stderr: null,
        stdout: null,
    };
    sessions.set(sessionId, session);

    const cancelled = () =>
        session.closing ||
        sessions.get(sessionId) !== session ||
        socket !== activeSocket ||
        socket.readyState !== WebSocket.OPEN;
    const container = docker.getContainer(server.container);

    try {
        const inspection = await container.inspect();
        assertContainerIdentityAndIsolation(inspection, server);
        if (cancelled()) {
            closeSession(sessionId, "Container attach was cancelled.", false);
            return;
        }
        if (!inspection.State?.Running) {
            sessions.delete(sessionId);
            session.closing = true;
            sendContainerState(socket, sessionId, "stopped", undefined, serverId);
            log("container_not_running", { sessionId, serverId, container: server.container });
            return;
        }
        const inputEnabled = Boolean(inspection.Config?.OpenStdin);
        sendContainerState(socket, sessionId, "running", undefined, serverId);

        session.output = await container.logs({
            follow: true,
            stderr: true,
            stdout: true,
            tail: tailLines,
            timestamps: false,
        });
        if (cancelled()) {
            session.output.destroy();
            closeSession(sessionId, "Container attach was cancelled.", false);
            return;
        }

        if (inputEnabled) {
            session.input = await container.attach({
                // docker-modem otherwise serializes the attach options as the POST
                // body, which Docker forwards into the hijacked stdin stream.
                _body: "",
                hijack: true,
                stdin: true,
                stream: true,
                stdout: false,
                stderr: false,
            });
            if (cancelled()) {
                session.input.destroy();
                session.output.destroy();
                closeSession(sessionId, "Container attach was cancelled.", false);
                return;
            }
        }

        const forwardOutput = (stream, chunk) => {
            if (!streamOutput(socket, sessionId, stream, chunk)) {
                closeSession(sessionId, "The gateway could not keep up with container output.");
            }
        };

        if (inspection.Config?.Tty) {
            session.output.on("data", (chunk) => forwardOutput("stdout", chunk));
        } else {
            session.stdout = new PassThrough();
            session.stderr = new PassThrough();
            session.stdout.on("data", (chunk) => forwardOutput("stdout", chunk));
            session.stderr.on("data", (chunk) => forwardOutput("stderr", chunk));
            docker.modem.demuxStream(session.output, session.stdout, session.stderr);
        }

        session.output.once("end", () => closeSession(sessionId, "Container output ended."));
        session.output.once("error", () => closeSession(sessionId, "Container output failed."));
        session.input?.once("error", () => closeSession(sessionId, "Container input failed."));
        session.pending = false;

        if (!send(socket, { type: "attached", sessionId, inputEnabled })) {
            closeSession(sessionId, "Gateway connection changed.", false);
            return;
        }
        log("container_attached", { sessionId, serverId, container: server.container });
    } catch (error) {
        const wasCancelled = cancelled();
        if (sessions.get(sessionId) === session) sessions.delete(sessionId);
        session.closing = true;
        session.output?.destroy();
        session.input?.destroy();
        session.stdout?.destroy();
        session.stderr?.destroy();
        if (wasCancelled) return;

        const errorMessage = error instanceof Error
            ? error.message.slice(0, 300)
            : "The Docker container could not be attached.";
        send(socket, { type: "error", sessionId, message: errorMessage });
        sendContainerState(socket, sessionId, "error", errorMessage, serverId);
        log("container_attach_failed", { sessionId, serverId, message: errorMessage });
    }
}

function closeAllSessions(message) {
    for (const sessionId of [...sessions.keys()]) {
        closeSession(sessionId, message, false);
    }
}

function scheduleReconnect() {
    if (stopping || reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempts, 5));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
    log("gateway_reconnect_scheduled", { delayMs: delay });
}

function connect() {
    if (stopping) return;

    const socket = new WebSocket(gatewayUrl, {
        headers: { authorization: `Bearer ${nodeToken}` },
        maxPayload: 256 * 1024,
    });
    activeSocket = socket;

    socket.on("open", () => {
        if (socket !== activeSocket) {
            socket.close();
            return;
        }
        reconnectAttempts = 0;
        send(socket, {
            type: "register",
            nodeId,
            servers: [...servers.keys()],
        });
        log("gateway_connected", { nodeId, servers: [...servers.keys()] });
    });

    socket.on("message", (data) => {
        if (socket !== activeSocket) return;
        const message = parseMessage(data);
        if (!message || typeof message.type !== "string") return;

        if (
            message.type === "attach" &&
            typeof message.serverId === "string" &&
            typeof message.sessionId === "string"
        ) {
            void attachSession(socket, message);
            return;
        }

        if (
            message.type === "operation" &&
            typeof message.serverId === "string" &&
            typeof message.sessionId === "string" &&
            typeof message.operation === "string" &&
            CONTAINER_OPERATIONS.has(message.operation)
        ) {
            void executeOperation(socket, message);
            return;
        }

        if (
            message.type === "input" &&
            typeof message.sessionId === "string" &&
            typeof message.data === "string" &&
            Buffer.byteLength(message.data) <= 4096 &&
            !message.data.includes("\0")
        ) {
            const session = sessions.get(message.sessionId);
            if (session?.input) {
                try {
                    if (!session.input.write(message.data)) {
                        closeSession(
                            message.sessionId,
                            "The container is not consuming console input fast enough.",
                        );
                    }
                } catch {
                    closeSession(message.sessionId, "Container input failed.");
                }
            }
            return;
        }

        if (message.type === "close" && typeof message.sessionId === "string") {
            rememberClosedSession(message.sessionId);
            closeSession(message.sessionId, "Gateway closed the session.", false);
        }
    });

    socket.on("close", (code, reason) => {
        if (socket !== activeSocket) return;
        activeSocket = null;
        closeAllSessions("Gateway disconnected.");
        log("gateway_disconnected", { code, reason: reason.toString() });
        scheduleReconnect();
    });

    socket.on("error", (error) => {
        log("gateway_connection_error", { message: error.message });
    });
}

function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    closeAllSessions("Node agent stopping.");
    activeSocket?.close(1000, "Node agent stopping");
    log("node_agent_stopping", { signal });
    setTimeout(() => process.exit(0), 250).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

connect();
