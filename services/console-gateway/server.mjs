import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const BROWSER_PATH = "/v1/browser";
const NODE_PATH = "/v1/node";
const DEFAULT_SERVER_NODES = {
    "bannerlord-live-15-204-120-17": "vps-15-204-120-17",
};
const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
const INPUT_RATE_WINDOW_MS = 1000;
const MAX_INPUT_BYTES_PER_WINDOW = 16 * 1024;
const CONTAINER_OPERATIONS = new Set(["start", "stop", "restart", "update"]);
const CONTAINER_STATES = new Set([
    "error",
    "running",
    "starting",
    "stopped",
    "stopping",
    "restarting",
    "updating",
]);

function required(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function parseJsonObject(name, fallback) {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${name} must be a JSON object.`);
    }

    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error(`${name} must be a JSON object.`);
    }

    for (const [key, value] of Object.entries(parsed)) {
        if (!key || typeof value !== "string" || !value) {
            throw new Error(`${name} must map non-empty strings to non-empty strings.`);
        }
    }
    return parsed;
}

function positiveInteger(name, fallback, maximum) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
    }
    return value;
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

function parseMessage(data) {
    try {
        return JSON.parse(data.toString());
    } catch {
        return null;
    }
}

function safeTokenMatch(header, expectedToken) {
    const actual = typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice(7)
        : "";
    const actualHash = createHash("sha256").update(actual).digest();
    const expectedHash = createHash("sha256").update(expectedToken).digest();
    return timingSafeEqual(actualHash, expectedHash);
}

function rejectUpgrade(socket, status, message) {
    socket.write(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
    );
    socket.destroy();
}

function audit(event, details = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...details,
    }));
}

const port = positiveInteger("PORT", 8787, 65535);
const authenticationTimeoutMs = positiveInteger("CONSOLE_AUTH_TIMEOUT_MS", 10_000, 60_000);
const sessionMaxMs = positiveInteger("CONSOLE_SESSION_MAX_MS", 600_000, 3_600_000);
const operationTimeoutMs = positiveInteger("CONSOLE_OPERATION_TIMEOUT_MS", 900_000, 1_800_000);
const maxBrowserConnections = positiveInteger("CONSOLE_MAX_BROWSER_CONNECTIONS", 100, 10_000);
const maxConcurrentAuthentications = positiveInteger("CONSOLE_MAX_CONCURRENT_AUTHS", 10, 1_000);
const maxUpgradesPerMinute = positiveInteger("CONSOLE_MAX_UPGRADES_PER_MINUTE", 30, 10_000);
const trustProxy = process.env.CONSOLE_TRUST_PROXY === "true";
const nodeToken = required("CONSOLE_NODE_TOKEN");
if (nodeToken.length < 32) throw new Error("CONSOLE_NODE_TOKEN must contain at least 32 characters.");

const allowedOrigins = new Set(
    required("CONSOLE_ALLOWED_ORIGINS")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
);
const bootstrapAdminEmails = new Set(
    (process.env.SUPABASE_ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
);
const serverNodes = new Map(Object.entries(
    parseJsonObject("CONSOLE_SERVER_NODES", DEFAULT_SERVER_NODES),
));

const supabase = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
);

const nodeConnections = new Map();
const operatorSessions = new Map();
const activeServerSessions = new Map();
const activeServerOperations = new Map();
const browserUpgradeWindows = new Map();
let concurrentAuthentications = 0;
const browserServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const nodeServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

function closeOperatorSession(sessionId, reason, closeBrowser = false) {
    const session = operatorSessions.get(sessionId);
    if (!session) return;

    operatorSessions.delete(sessionId);
    if (activeServerSessions.get(session.serverId) === sessionId) {
        activeServerSessions.delete(session.serverId);
    }
    clearTimeout(session.expiry);

    const node = nodeConnections.get(session.nodeId)?.socket;
    send(node, { type: "close", sessionId });
    send(session.browser, { type: "closed", message: reason });
    if (closeBrowser && session.browser.readyState === WebSocket.OPEN) {
        session.browser.close(1013, "Console session closed");
    }

    audit("console_session_closed", {
        sessionId,
        serverId: session.serverId,
        userId: session.userId,
        reason,
    });
}

function closeNodeSessions(nodeId, reason) {
    for (const [sessionId, session] of operatorSessions) {
        if (session.nodeId === nodeId) {
            closeOperatorSession(sessionId, reason, true);
        }
    }
}

function failNodeOperations(nodeId, reason) {
    for (const [serverId, operation] of activeServerOperations) {
        if (operation.nodeId !== nodeId) continue;
        clearTimeout(operation.timer);
        activeServerOperations.delete(serverId);
        const currentSession = operatorSessions.get(activeServerSessions.get(serverId));
        if (currentSession) {
            currentSession.pendingOperation = null;
            send(currentSession.browser, {
                type: "operationResult",
                operation: operation.operation,
                ok: false,
                message: reason,
            });
        }
    }
}

function removeNode(nodeId, socket) {
    if (nodeConnections.get(nodeId)?.socket !== socket) return;
    failNodeOperations(nodeId, "The node agent disconnected during the server operation; verify container state before retrying.");
    closeNodeSessions(nodeId, "The node agent disconnected.");
    nodeConnections.delete(nodeId);
    audit("node_disconnected", { nodeId });
}

nodeServer.on("connection", (socket) => {
    socket.isAlive = true;
    let registeredNodeId = null;
    const registrationTimeout = setTimeout(() => {
        socket.close(1008, "Node registration timed out");
    }, authenticationTimeoutMs);

    socket.on("pong", () => {
        socket.isAlive = true;
    });

    socket.on("message", (data) => {
        const message = parseMessage(data);
        if (!message || typeof message.type !== "string") {
            socket.close(1003, "Invalid node message");
            return;
        }

        if (!registeredNodeId) {
            if (
                message.type !== "register" ||
                typeof message.nodeId !== "string" ||
                !Array.isArray(message.servers)
            ) {
                socket.close(1008, "Node registration required");
                return;
            }

            const allowedServers = message.servers.filter(
                (serverId) =>
                    typeof serverId === "string" &&
                    serverNodes.get(serverId) === message.nodeId,
            );
            if (allowedServers.length === 0) {
                socket.close(1008, "Node has no configured servers");
                return;
            }

            registeredNodeId = message.nodeId;
            clearTimeout(registrationTimeout);
            const previous = nodeConnections.get(registeredNodeId)?.socket;
            if (previous && previous !== socket) {
                failNodeOperations(
                    registeredNodeId,
                    "The node agent reconnected during the server operation; verify container state before retrying.",
                );
                closeNodeSessions(registeredNodeId, "The node agent reconnected.");
                previous.close(1012, "Node reconnected");
            }

            nodeConnections.set(registeredNodeId, {
                socket,
                servers: new Set(allowedServers),
            });
            send(socket, { type: "registered", servers: allowedServers });
            audit("node_registered", { nodeId: registeredNodeId, servers: allowedServers });
            return;
        }

        if (nodeConnections.get(registeredNodeId)?.socket !== socket) {
            socket.close(1008, "Stale node connection");
            return;
        }

        if (
            message.type === "operationResult" &&
            typeof message.serverId === "string" &&
            typeof message.sessionId === "string" &&
            typeof message.operation === "string" &&
            CONTAINER_OPERATIONS.has(message.operation) &&
            typeof message.ok === "boolean"
        ) {
            const activeOperation = activeServerOperations.get(message.serverId);
            if (
                !activeOperation ||
                activeOperation.nodeId !== registeredNodeId ||
                activeOperation.initiatingSessionId !== message.sessionId ||
                activeOperation.operation !== message.operation
            ) return;

            clearTimeout(activeOperation.timer);
            activeServerOperations.delete(message.serverId);
            const currentSession = operatorSessions.get(
                activeServerSessions.get(message.serverId),
            );
            const resultMessage = typeof message.message === "string"
                ? message.message.slice(0, 300)
                : message.ok
                    ? "Server operation completed."
                    : "Server operation failed.";
            if (currentSession) {
                currentSession.pendingOperation = null;
                send(currentSession.browser, {
                    type: "operationResult",
                    operation: message.operation,
                    ok: message.ok,
                    message: resultMessage,
                });
                if (
                    currentSession.containerState === "running" &&
                    !currentSession.consoleAttached
                ) {
                    send(socket, {
                        type: "attach",
                        serverId: message.serverId,
                        sessionId: activeServerSessions.get(message.serverId),
                    });
                }
            }
            audit("container_operation_completed", {
                sessionId: message.sessionId,
                serverId: message.serverId,
                userId: activeOperation.userId,
                operation: message.operation,
                ok: message.ok,
            });
            return;
        }

        if (
            message.type === "containerState" &&
            typeof message.serverId === "string" &&
            typeof message.state === "string" &&
            CONTAINER_STATES.has(message.state)
        ) {
            const currentSession = operatorSessions.get(
                activeServerSessions.get(message.serverId),
            );
            if (!currentSession || currentSession.nodeId !== registeredNodeId) return;

            currentSession.containerState = message.state;
            currentSession.inputEnabled = message.state === "running" && currentSession.consoleAttached
                ? currentSession.consoleInputEnabled
                : false;
            send(currentSession.browser, {
                type: "containerState",
                state: message.state,
                inputEnabled: currentSession.inputEnabled,
                ...(typeof message.message === "string"
                    ? { message: message.message.slice(0, 300) }
                    : {}),
            });
            return;
        }

        if (
            ["attached", "closed", "error"].includes(message.type) &&
            typeof message.sessionId === "string"
        ) {
            const session = operatorSessions.get(message.sessionId);
            if (!session || session.nodeId !== registeredNodeId) return;

            if (message.type === "attached") {
                session.consoleAttached = true;
                session.consoleInputEnabled = message.inputEnabled === true;
                session.inputEnabled = session.consoleInputEnabled;
                session.containerState = "running";
                if (!send(session.browser, {
                    type: "attached",
                    inputEnabled: session.inputEnabled,
                })) {
                    closeOperatorSession(
                        message.sessionId,
                        "The browser disconnected before the container attached.",
                        true,
                    );
                    return;
                }
                audit("container_attached", {
                    sessionId: message.sessionId,
                    serverId: session.serverId,
                });
                return;
            }

            const reason = typeof message.message === "string"
                ? message.message.slice(0, 300)
                : message.type === "error"
                    ? "The node agent could not attach to the container."
                    : "The container stream closed.";
            session.consoleAttached = false;
            session.consoleInputEnabled = false;
            session.inputEnabled = false;
            send(session.browser, {
                type: message.type === "error" ? "error" : "consoleClosed",
                message: reason,
            });
            return;
        }

        if (
            message.type === "output" &&
            typeof message.sessionId === "string" &&
            (message.stream === "stdout" || message.stream === "stderr") &&
            typeof message.data === "string" &&
            message.data.length <= 196_608
        ) {
            const session = operatorSessions.get(message.sessionId);
            if (!session || session.nodeId !== registeredNodeId) return;
            if (!send(session.browser, {
                type: "output",
                stream: message.stream,
                data: message.data,
            })) {
                closeOperatorSession(
                    message.sessionId,
                    "The browser could not keep up with container output.",
                    true,
                );
            }
        }
    });

    socket.on("close", () => {
        clearTimeout(registrationTimeout);
        if (registeredNodeId) removeNode(registeredNodeId, socket);
    });
});

browserServer.on("connection", (socket, request) => {
    socket.isAlive = true;
    let sessionId = null;
    let authenticationStarted = false;
    const authenticationTimeout = setTimeout(() => {
        socket.close(1008, "Authentication timed out");
    }, authenticationTimeoutMs);

    socket.on("pong", () => {
        socket.isAlive = true;
    });

    socket.on("message", async (data) => {
        const message = parseMessage(data);
        if (!message || typeof message.type !== "string") {
            socket.close(1003, "Invalid console message");
            return;
        }

        if (!sessionId) {
            if (authenticationStarted) return;
            if (
                message.type !== "authenticate" ||
                typeof message.accessToken !== "string" ||
                typeof message.serverId !== "string" ||
                message.accessToken.length > 16_384
            ) {
                socket.close(1008, "Authentication required");
                return;
            }
            authenticationStarted = true;

            const expectedNodeId = serverNodes.get(message.serverId);
            if (!expectedNodeId) {
                socket.close(1008, "Unknown console server");
                return;
            }
            if (activeServerSessions.has(message.serverId)) {
                send(socket, { type: "error", message: "Another Admin is already attached to this console." });
                socket.close(1008, "Console already in use");
                return;
            }

            if (concurrentAuthentications >= maxConcurrentAuthentications) {
                socket.close(1013, "Authentication service is busy");
                return;
            }

            concurrentAuthentications += 1;
            let userData = { user: null };
            let authenticationError = null;
            try {
                const result = await supabase.auth.getUser(message.accessToken);
                userData = result.data;
                authenticationError = result.error;
            } catch (error) {
                authenticationError = error;
            } finally {
                concurrentAuthentications -= 1;
            }
            if (socket.readyState !== WebSocket.OPEN) return;

            const user = userData.user;
            const bootstrapAdmin = Boolean(
                user?.email && bootstrapAdminEmails.has(user.email.toLowerCase()),
            );
            if (authenticationError || !user || (user.app_metadata?.role !== "Admin" && !bootstrapAdmin)) {
                audit("console_auth_rejected", {
                    serverId: message.serverId,
                    origin: request.headers.origin,
                });
                socket.close(1008, "Admin authorization failed");
                return;
            }

            if (activeServerSessions.has(message.serverId)) {
                send(socket, { type: "error", message: "Another Admin is already attached to this console." });
                socket.close(1008, "Console already in use");
                return;
            }

            const node = nodeConnections.get(expectedNodeId);
            if (!node || !node.servers.has(message.serverId)) {
                send(socket, { type: "error", message: "The server node agent is offline." });
                socket.close(1013, "Node agent offline");
                return;
            }

            clearTimeout(authenticationTimeout);
            const activeOperation = activeServerOperations.get(message.serverId);
            sessionId = randomUUID();
            const expiry = setTimeout(() => {
                closeOperatorSession(sessionId, "The maximum console session time was reached.", true);
            }, sessionMaxMs);
            operatorSessions.set(sessionId, {
                browser: socket,
                consoleAttached: false,
                consoleInputEnabled: false,
                containerState: "unknown",
                expiry,
                inputBytes: 0,
                inputEnabled: false,
                inputWindowStartedAt: Date.now(),
                nodeId: expectedNodeId,
                pendingOperation: activeOperation?.operation ?? null,
                serverId: message.serverId,
                userId: user.id,
            });
            activeServerSessions.set(message.serverId, sessionId);

            send(socket, { type: "ready", expiresInMs: sessionMaxMs });
            if (activeOperation) {
                send(socket, {
                    type: "operationPending",
                    operation: activeOperation.operation,
                });
            }
            if (!send(node.socket, {
                type: "attach",
                serverId: message.serverId,
                sessionId,
            })) {
                closeOperatorSession(sessionId, "The node agent is unavailable.", true);
                return;
            }
            audit("console_session_opened", {
                sessionId,
                serverId: message.serverId,
                userId: user.id,
                bootstrapAdmin,
            });
            return;
        }

        if (
            message.type === "operation" &&
            typeof message.operation === "string" &&
            CONTAINER_OPERATIONS.has(message.operation)
        ) {
            const session = operatorSessions.get(sessionId);
            if (!session) return;
            const existingOperation = activeServerOperations.get(session.serverId);
            if (existingOperation) {
                send(socket, {
                    type: "operationPending",
                    operation: existingOperation.operation,
                    message: `The ${existingOperation.operation} operation is still running.`,
                });
                return;
            }

            const node = nodeConnections.get(session.nodeId)?.socket;
            session.pendingOperation = message.operation;
            const operationRecord = {
                initiatingSessionId: sessionId,
                nodeId: session.nodeId,
                operation: message.operation,
                serverId: session.serverId,
                timedOut: false,
                timer: null,
                userId: session.userId,
            };
            operationRecord.timer = setTimeout(() => {
                const activeOperation = activeServerOperations.get(session.serverId);
                if (activeOperation !== operationRecord) return;
                operationRecord.timedOut = true;
                const currentSession = operatorSessions.get(
                    activeServerSessions.get(session.serverId),
                );
                if (currentSession) {
                    send(currentSession.browser, {
                        type: "operationPending",
                        operation: message.operation,
                        message: "The operation is taking longer than expected and is still reserved until the node reports completion.",
                    });
                }
            }, operationTimeoutMs);
            activeServerOperations.set(session.serverId, operationRecord);

            if (!send(node, {
                type: "operation",
                operation: message.operation,
                serverId: session.serverId,
                sessionId,
            })) {
                clearTimeout(operationRecord.timer);
                activeServerOperations.delete(session.serverId);
                session.pendingOperation = null;
                closeOperatorSession(sessionId, "The node agent is unavailable.", true);
                return;
            }
            audit("container_operation_requested", {
                sessionId,
                serverId: session.serverId,
                userId: session.userId,
                operation: message.operation,
            });
            return;
        }

        if (
            message.type === "input" &&
            typeof message.data === "string" &&
            Buffer.byteLength(message.data) <= 4096 &&
            !message.data.includes("\0")
        ) {
            const session = operatorSessions.get(sessionId);
            if (!session) return;
            if (!session.inputEnabled) {
                send(socket, {
                    type: "error",
                    message: "This container was not started with stdin enabled.",
                });
                return;
            }

            const now = Date.now();
            if (now - session.inputWindowStartedAt >= INPUT_RATE_WINDOW_MS) {
                session.inputWindowStartedAt = now;
                session.inputBytes = 0;
            }
            const inputBytes = Buffer.byteLength(message.data);
            session.inputBytes += inputBytes;
            if (session.inputBytes > MAX_INPUT_BYTES_PER_WINDOW) {
                closeOperatorSession(sessionId, "Console input rate limit exceeded.", true);
                return;
            }

            const node = nodeConnections.get(session.nodeId)?.socket;
            if (!send(node, {
                type: "input",
                sessionId,
                data: message.data,
            })) {
                closeOperatorSession(sessionId, "The node agent is unavailable.", true);
                return;
            }
            audit("console_input_sent", {
                sessionId,
                serverId: session.serverId,
                userId: session.userId,
                bytes: inputBytes,
            });
        }
    });

    socket.on("close", () => {
        clearTimeout(authenticationTimeout);
        if (sessionId) closeOperatorSession(sessionId, "Admin disconnected.", false);
    });
});

const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
            ok: true,
            connectedNodes: nodeConnections.size,
            activeOperations: activeServerOperations.size,
        }));
        return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
});

function browserClientAddress(request) {
    if (trustProxy) {
        const forwarded = request.headers["x-forwarded-for"];
        if (typeof forwarded === "string") {
            return forwarded.split(",")[0].trim().slice(0, 100);
        }
    }
    return request.socket.remoteAddress ?? "unknown";
}

function allowBrowserUpgrade(address) {
    const now = Date.now();
    const current = browserUpgradeWindows.get(address);
    if (!current || now - current.startedAt >= 60_000) {
        browserUpgradeWindows.set(address, { count: 1, startedAt: now });
        return true;
    }
    current.count += 1;
    return current.count <= maxUpgradesPerMinute;
}

server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://console-gateway.local");

    if (url.pathname === NODE_PATH) {
        if (!safeTokenMatch(request.headers.authorization, nodeToken)) {
            rejectUpgrade(socket, "401 Unauthorized", "Unauthorized");
            return;
        }
        nodeServer.handleUpgrade(request, socket, head, (webSocket) => {
            nodeServer.emit("connection", webSocket, request);
        });
        return;
    }

    if (url.pathname === BROWSER_PATH) {
        const origin = request.headers.origin;
        const address = browserClientAddress(request);
        if (!origin || !allowedOrigins.has(origin)) {
            rejectUpgrade(socket, "403 Forbidden", "Origin not allowed");
            return;
        }
        if (
            browserServer.clients.size >= maxBrowserConnections ||
            !allowBrowserUpgrade(address)
        ) {
            audit("browser_upgrade_rate_limited", { address });
            rejectUpgrade(socket, "429 Too Many Requests", "Too many console connections");
            return;
        }
        browserServer.handleUpgrade(request, socket, head, (webSocket) => {
            browserServer.emit("connection", webSocket, request);
        });
        return;
    }

    rejectUpgrade(socket, "404 Not Found", "Not found");
});

const heartbeat = setInterval(() => {
    const staleUpgradeWindowBefore = Date.now() - 60_000;
    for (const [address, window] of browserUpgradeWindows) {
        if (window.startedAt < staleUpgradeWindowBefore) {
            browserUpgradeWindows.delete(address);
        }
    }

    for (const webSocketServer of [browserServer, nodeServer]) {
        for (const socket of webSocketServer.clients) {
            if (socket.isAlive === false) {
                socket.terminate();
                continue;
            }
            socket.isAlive = false;
            socket.ping();
        }
    }
}, 30_000);

server.listen(port, "0.0.0.0", () => {
    audit("gateway_started", {
        port,
        browserPath: BROWSER_PATH,
        nodePath: NODE_PATH,
        configuredServers: [...serverNodes.keys()],
        maxBrowserConnections,
        maxConcurrentAuthentications,
    });
});

function shutdown(signal) {
    audit("gateway_stopping", { signal });
    clearInterval(heartbeat);
    for (const operation of activeServerOperations.values()) {
        clearTimeout(operation.timer);
    }
    activeServerOperations.clear();
    for (const sessionId of [...operatorSessions.keys()]) {
        closeOperatorSession(sessionId, "The console gateway is restarting.", true);
    }
    for (const connection of nodeConnections.values()) connection.socket.close(1012, "Gateway restart");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
