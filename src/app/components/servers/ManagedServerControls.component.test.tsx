import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as serverActions from "@/app/servers/managed-server-actions";
import { ManagedServerControls, ManagedServerPassword } from "./ManagedServerControls";
import { ManagedServerMoveProvider, ManagedServerMoveStatus } from "./ManagedServerMoveStatus";
import { ManagedServerMaintenance, ManagedServerMaintenanceProvider } from "./ManagedServerMaintenance";
import { MyServersApiError, readMyServersResponse } from "@/app/lib/hosting/my-servers";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import type { MyServerMove } from "@/app/lib/control-plane/types";
import type { OwnerRuntimeInsight } from "@/app/lib/hosting/owner-runtime-insight";

const { revealAddress } = vi.hoisted(() => ({ revealAddress: vi.fn() }));
const { backupStatus, deletionStatus } = vi.hoisted(() => ({ backupStatus: vi.fn(), deletionStatus: vi.fn() }));
vi.mock("./ServerManagementWorkspace", async original => ({
    ...await original<typeof import("./ServerManagementWorkspace")>(), useRevealServerAddress: () => revealAddress,
}));

const { request, requestUpdate, requestPassword, beginPolling, startStatus, summary, router, statusSlot } = vi.hoisted(() => ({ request: vi.fn(), requestUpdate: vi.fn(), requestPassword: vi.fn(), beginPolling: vi.fn(), startStatus: vi.fn(), summary: vi.fn(), router: { refresh: vi.fn() }, statusSlot: { current: undefined as HTMLElement | null | undefined } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({ getMyServerStartStatus: startStatus, getMyServerSummary: summary, getMyServerDeletionStatus: deletionStatus }));
afterEach(() => vi.useRealTimers());

it.each(["refused", "unknown", "masked", "success"])("renders the supported owner envelope for %s with zero console errors", async outcome => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const consoleError = vi.spyOn(console, "error");
    const serverId = "22222222-2222-4222-8222-222222222222";
    request.mockReset(); beginPolling.mockClear();
    request.mockImplementationOnce(async () => {
        const edge = createMyServersHandler({ allowedOrigins: ["https://bannerlordcoop.com"], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {},
            fetchImplementation: async () => outcome === "unknown" ? new Response("Gateway timeout", { status: 504 })
                : Response.json(outcome === "refused"
                    ? { ok: false, error: { code: "server_suspended", message: "This server is suspended. Contact the hosting team for help.", retryable: false } }
                    : outcome === "masked" ? { ok: false, error: { code: "container_command_unavailable", message: "The container command could not be confirmed.", retryable: false } }
                        : { ok: true, result: { exitCode: 0 } }, { status: ["refused", "masked"].includes(outcome) ? 409 : 200 }) });
        const response = await edge(new Request("https://function.example.test", { method: "POST", headers: {
            authorization: "Bearer synthetic-access-token-with-enough-characters", "content-type": "application/json", "x-request-id": serverId,
        }, body: JSON.stringify({ serverId, action: "start" }) }));
        return readMyServersResponse(response, serverId);
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls observedGameState="stopped" serverId={serverId} displayName="Campaign"
            accessRole="owner" operationState="stopped" expectedUpdatedAt="2026-09-20T12:00:00.000Z" /></TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        if (outcome === "refused") {
            expect(container.textContent).toContain("This server is suspended. The request was refused and no change was made.");
            expect(container.textContent).not.toMatch(/couldn.t confirm/u);
            expect(beginPolling).not.toHaveBeenCalled();
        } else if (outcome === "unknown" || outcome === "masked") {
            expect(container.textContent).toMatch(/couldn.t confirm/u);
            expect(container.textContent).not.toContain("This server is suspended");
        } else expect(container.textContent).toContain("Server started and game readiness confirmed");
        expect(request).toHaveBeenCalledOnce();
        expect(consoleError).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); consoleError.mockRestore(); }
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: async () => ({ auth: {
        getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { access_token: "token" } } }),
    } }),
}));
vi.mock("@/app/lib/hosting/my-servers", async (original) => ({
    ...await original<typeof import("@/app/lib/hosting/my-servers")>(),
    requestMyServerOperation: request,
    requestMyServerUpdate: requestUpdate,
    requestMyServerPassword: requestPassword,
    getMyServerBackupStatus: backupStatus,
}));
vi.mock("@/app/servers/managed-server-move-actions", () => ({ readManagedServerMoveStatus: async () => ({ ok: false }) }));
vi.mock("./ManagedServerPollingProvider", () => ({
    useManagedServerPolling: () => ({ session: null, timedOutSession: null, beginPolling, endPolling: vi.fn() }),
    useManagedConsoleSignals: () => null,
    useManagedServerSaves: () => null,
    useManagedServerStatusSlot: () => statusSlot.current,
}));

it("refreshes the polling fingerprint when lifecycle hints unlock without another server revision", async () => {
    const serverId = "22222222-2222-4222-8222-222222222222";
    const status = { updatedAt: "2026-10-02T16:00:03.000Z", operationState: "stopped", observedGameState: "stopped", job: null };
    backupStatus.mockResolvedValue(status);
    deletionStatus.mockResolvedValue(null);
    summary.mockResolvedValue({ ...status, runtimeInsight: { desiredState: "stopped", allowedActions: [] } });
    const blocked = await serverActions.readManagedServerStatusFingerprint(serverId);
    expect(blocked.ok).toBe(true);
    summary.mockResolvedValue({ ...status, runtimeInsight: { desiredState: "stopped", allowedActions: ["start"] } });
    const ready = await serverActions.readManagedServerStatusFingerprint(serverId);
    expect(ready.ok).toBe(true);
    expect(ready).not.toEqual(blocked);
});

it.each([
    [null, "Server started and game readiness confirmed"],
    ["container_command_failed", "exit code 125"],
])("shows the command result without polling or retrying: %s", async (code, message) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const serverId = "22222222-2222-4222-8222-222222222222";
    request.mockReset();
    beginPolling.mockClear();
    if (code) request.mockRejectedValue(new MyServersApiError(code, "The container command failed with exit code 125."));
    else request.mockResolvedValue({ exitCode: 0 });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" serverId={serverId} displayName="Campaign"
            accessRole="owner" operationState="stopped" expectedUpdatedAt="2026-09-20T12:00:00.000Z" />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain(message);
        expect(container.querySelector('input[type="password"]')).toBeNull();
        expect(beginPolling).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledExactlyOnceWith("token", { serverId, action: "start" });
    } finally { await act(async () => root.unmount()); }
});

it.each([undefined, "55555555-5555-4555-8555-555555555555"])("recognizes an accepted Start only with its durable operation ID: %s", async (operationId) => {
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, operationId));
    const result = await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222", action: "start" });
    expect(result.ok).toBe(operationId !== undefined);
    expect(result.message).toContain(operationId === undefined ? "We couldn’t confirm that your Start request went through" : "Start accepted");
    expect(result.checkStatus === true).toBe(operationId === undefined);
    expect(request).toHaveBeenCalledTimes(1);
});

it.each([null, "container_command_unavailable", "server_api_unavailable", "invalid_response", "server_not_found", "container_command_failed"])(
    "checks Stop status after acceptance or an unknown outcome, but preserves definitive rejection: %s", async code => {
        request.mockReset();
        if (code) request.mockRejectedValue(new MyServersApiError(code, "The container command failed with exit code 125."));
        else request.mockResolvedValue({ exitCode: 0 });
        const result = await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222", action: "stop" });
        const definitive = code === "server_not_found" || code === "container_command_failed";
        expect(result.ok).toBe(code === null);
        expect(result.checkStatus === true).toBe(!definitive);
        expect(result.message).not.toContain("It may have executed");
        expect(request).toHaveBeenCalledTimes(1);
    },
);

it("refreshes after a lifecycle conflict without pretending this tab submitted Stop", async () => {
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_in_progress", "Another server operation is already in progress."));
    const result = await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222", action: "stop" });
    expect(result).toEqual({ ok: false, refresh: true, message: "Another server operation is active. Wait for its status to finish, then try again." });
});

it.each([
    ["stop", "Stop"],
    ["restart-game", "Restart"],
] as const)("asks the owner to retry %s after the save, without checking status", async (action, label) => {
    request.mockReset().mockRejectedValue(new MyServersApiError("save_in_progress",
        "The game is saving right now. Wait a few seconds for the save to finish, then try again.", true));
    const result = await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222", action });
    expect(result).toEqual({ ok: false,
        message: `The game is saving right now. Wait a few seconds for the save to finish, then try ${label} again.` });
    expect(request).toHaveBeenCalledTimes(1);
});

it("reports an accepted Restart honestly instead of an exit code", async () => {
    request.mockReset().mockResolvedValue({ exitCode: 0 });
    const result = await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222", action: "restart-game" });
    expect(result).toEqual({ ok: true, message: "Restarting. Players can rejoin once the campaign finishes loading, usually within a couple of minutes." });
    request.mockReset().mockRejectedValue(new MyServersApiError("server_api_unavailable", "Unavailable", true));
    expect(await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222", action: "restart-game" })).toEqual({
        ok: false, checkStatus: true, message: "We couldn’t confirm that your Restart request went through, so we’re checking your server’s status…",
    });
});

it("asks the page to refresh after an unconfirmed password change", async () => {
    requestPassword.mockReset().mockRejectedValue(new Error("lost response"));
    expect(await serverActions.setManagedServerPassword({ serverId: "22222222-2222-4222-8222-222222222222", expectedUpdatedAt: "2026-09-28T00:00:00.000Z", password: "fixture" })).toEqual({
        ok: false, checkStatus: true, message: "We couldn’t confirm the password change, so we refreshed your server’s status. If the new password doesn’t work, set it again.",
    });
});

it("explains in plain language that Stop/Restart disconnect players and respects cancellation", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="running" serverId="22222222-2222-4222-8222-222222222222"
            displayName="Campaign" accessRole="owner" operationState="running" expectedUpdatedAt="2026-09-20T12:00:00.000Z" />} </TestLocalization>));
        for (const index of [1, 2]) {
            await act(async () => container.querySelectorAll("button")[index].click());
            expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("Everyone connected will be disconnected"));
            expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("The server saves the campaign as it shuts down, but recent progress could be lost."));
            expect(confirm).not.toHaveBeenLastCalledWith(expect.stringContaining("save-flush"));
        }
        expect(request).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

it("confirms and queues an immediate update with the displayed server revision", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requestUpdate.mockReset().mockResolvedValue({
        outcome: "enqueued", jobId: "55555555-5555-4555-8555-555555555555", action: "update",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" serverId="22222222-2222-4222-8222-222222222222"
            displayName="Campaign" accessRole="owner" operationState="running"
            expectedUpdatedAt="2026-09-20T12:00:00.000Z" />} </TestLocalization>));
        await act(async () => container.querySelectorAll("button")[3].click());
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("backup will be taken first"));
        expect(requestUpdate).toHaveBeenCalledWith("token", {
            serverId: "22222222-2222-4222-8222-222222222222",
            expectedUpdatedAt: "2026-09-20T12:00:00.000Z",
        }, expect.any(String));
        expect(container.textContent).toContain("Update queued");
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

it.each(["stable", "nightly"] as const)("refreshes the update revision only while the displayed channel is unchanged: %s", async channel => {
    const serverId = "22222222-2222-4222-8222-222222222222";
    const expectedUpdatedAt = "2026-09-20T12:00:00.000Z";
    const fresh = "2026-09-20T12:01:00.000Z";
    summary.mockReset().mockResolvedValue({ serverId, releaseChannel: channel, updatedAt: fresh });
    requestUpdate.mockReset().mockResolvedValue({ outcome: "enqueued" });
    expect(await serverActions.operateManagedServer({ serverId, action: "update-now", expectedUpdatedAt, expectedReleaseChannel: channel })).toMatchObject({ ok: true });
    expect(requestUpdate).toHaveBeenCalledExactlyOnceWith("token", { serverId, expectedUpdatedAt: fresh }, expect.any(String));
    summary.mockResolvedValue({ serverId, releaseChannel: channel === "stable" ? "nightly" : "stable", updatedAt: fresh });
    requestUpdate.mockClear();
    expect(await serverActions.operateManagedServer({ serverId, action: "update-now", expectedUpdatedAt, expectedReleaseChannel: channel })).toMatchObject({ ok: false, refresh: true });
    expect(requestUpdate).not.toHaveBeenCalled();
});

it("shows a terminal load crash and refreshes without submitting another Start", async () => {
    request.mockReset().mockRejectedValue(new MyServersApiError("game_crashed_during_load", "The game crashed while loading your campaign."));
    expect(await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222", action: "start" }))
        .toEqual({ ok: false, refresh: true, message: "The game crashed while loading your campaign." });
    expect(request).toHaveBeenCalledOnce();
});

it("does not claim Update now was sent when its freshness read failed", async () => {
    summary.mockReset().mockRejectedValue(new MyServersApiError("server_api_unavailable", "Unavailable"));
    requestUpdate.mockClear();
    const result = await serverActions.operateManagedServer({ serverId: "22222222-2222-4222-8222-222222222222",
        action: "update-now", expectedUpdatedAt: "2026-09-20T12:00:00.000Z", expectedReleaseChannel: "stable" });
    expect(result).toMatchObject({ ok: false, refresh: true });
    expect(result.checkStatus).not.toBe(true);
    expect(result.message).not.toContain("went through");
    expect(result.message).toContain("No update was sent");
    expect(requestUpdate).not.toHaveBeenCalled();
});

it("sets a private website password once and clears the input", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requestPassword.mockReset().mockResolvedValue({ changed: true, restartQueued: false });
    const container = document.createElement("div"); const root = createRoot(container);
    const serverId = "22222222-2222-4222-8222-222222222222";
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerPassword serverId={serverId} accessRole="owner" operationState="stopped" expectedUpdatedAt="2026-09-28T00:00:00.000Z" />} </TestLocalization>));
        const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Private-fixture-password");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        expect(requestPassword).toHaveBeenCalledExactlyOnceWith("token", { serverId, expectedUpdatedAt: "2026-09-28T00:00:00.000Z", password: "Private-fixture-password" }, expect.any(String));
        expect(input.value).toBe("");
        expect(container.textContent).toContain("Password changed");
        expect(container.textContent).not.toContain("Private-fixture-password");
    } finally { await act(async () => root.unmount()); }
});

it.each([false, true])("handles password delivery rejection or cancelled restart without retry: cancelled=%s", async (cancelled) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const failure = "Private-fixture-password request response lost";
    const action = vi.spyOn(serverActions, "setManagedServerPassword").mockRejectedValue(new Error(failure));
    router.refresh.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = document.createElement("div"); const root = createRoot(container);
    const serverId = "22222222-2222-4222-8222-222222222222";
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerPassword serverId={serverId} accessRole="owner" operationState={cancelled ? "running" : "stopped"} expectedUpdatedAt="2026-09-28T00:00:00.000Z" />} </TestLocalization>));
        const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Private-fixture-password");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        if (cancelled) {
            expect(confirm).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("restart the server"));
            expect(action).not.toHaveBeenCalled();
        } else {
            expect(action).toHaveBeenCalledExactlyOnceWith({ serverId, expectedUpdatedAt: "2026-09-28T00:00:00.000Z", password: "Private-fixture-password" });
            expect(input.value).toBe("");
            expect(container.textContent).toContain("We couldn’t confirm the password change, so we refreshed your server’s status. If the new password doesn’t work, set it again.");
            expect(router.refresh).toHaveBeenCalledOnce();
            expect(container.textContent).not.toContain(failure);
            expect(container.textContent).not.toContain("Private-fixture-password");
            expect(container.querySelector("form")).not.toBeNull();
            expect(container.querySelector('button[type="submit"]')).not.toBeNull();
        }
    } finally {
        await act(async () => root.unmount());
        action.mockRestore(); confirm.mockRestore();
    }
});


it("does not expose password settings to a manager", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerPassword serverId="22222222-2222-4222-8222-222222222222" accessRole="manager" operationState="running" expectedUpdatedAt="2026-09-28T00:00:00.000Z" />} </TestLocalization>));
        expect(container.querySelector("form")).toBeNull();
    } finally { await act(async () => root.unmount()); }
});

const progressServerId = "22222222-2222-4222-8222-222222222222";
const progressJobId = "55555555-5555-4555-8555-555555555555";
const progressProps = { serverId: progressServerId, displayName: "Campaign", accessRole: "owner" as const,
    operationState: "stopped", expectedUpdatedAt: "2026-09-20T12:00:00.000Z" };
function progress(phase: string, state = "running", label = phase) {
    return { serverId: progressServerId, jobId: progressJobId, phase, state, progress: label };
}

it.each(["failed", "retry-wait"] as const)("restores truthful %s progress after page reload without dispatching Start", async state => {
    vi.useFakeTimers();
    request.mockClear();
    const receipt = { action: "start" as const, jobId: progressJobId, state, phase: state, progress: `Attempt 2 of 5. ${state === "failed" ? "Automatic Start retries have stopped." : "Next retry: 2026-09-20T12:05:00.000Z."}`,
        attemptCount: 2, maximumAttempts: 5, nextRetryAt: state === "retry-wait" ? "2026-09-20T12:05:00.000Z" : null,
        stoppedRetrying: state === "failed", failureCode: state === "failed" ? "game_crashed_during_load" as const : null,
        recommendedAction: state === "failed" ? "review-backups" as const : null };
    const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: "2026-09-20T12:00:00.000Z", allowedActions: state === "failed" ? ["stop"] : [],
        crashLoopDetected: false, failureCode: receipt.failureCode, recommendedAction: receipt.recommendedAction,
        failureMessage: state === "failed" ? "The game crashed while loading your campaign." : null,
        recommendation: state === "failed" ? "Review available backups before choosing recovery." : null, start: receipt };
    startStatus.mockReset().mockResolvedValue({ serverId: progressServerId, ...receipt });
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="failed" operationState="failed" runtimeInsight={insight} /></TestLocalization>));
        expect(container.textContent).toContain("Attempt 2 of 5");
        if (state === "failed") {
            expect(container.textContent).toContain("Automatic Start retries have stopped");
            expect(container.textContent).toContain("Review available backups");
            expect(container.textContent).not.toContain("Waiting to retry");
        } else expect(container.textContent).toContain("Next retry:");
        const buttons = [...container.querySelectorAll("button")];
        expect(buttons.find(button => button.textContent?.startsWith("Start"))?.disabled).toBe(true);
        expect(buttons.find(button => button.textContent === "Stop")?.disabled).toBe(state !== "failed");
        expect(buttons.find(button => button.textContent === "Restart")?.disabled).toBe(true);
        expect(request).not.toHaveBeenCalled();
        expect(startStatus).toHaveBeenCalledTimes(state === "failed" ? 0 : 1);
    } finally { await act(async () => root.unmount()); }
});

it.each(["admin", "support"] as const)("keeps %s controls read-only while showing the safe failure insight", async accessRole => {
    const container = document.createElement("div"); const root = createRoot(container);
    const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: null, allowedActions: ["stop"],
        crashLoopDetected: false, failureCode: "game_crashed_during_load", recommendedAction: "review-backups",
        failureMessage: "The game crashed while loading your campaign.", recommendation: "Review available backups.", start: null };
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} accessRole={accessRole} observedGameState="failed" runtimeInsight={insight} /></TestLocalization>));
        expect(container.textContent).toContain(insight.failureMessage);
        expect(container.textContent).toContain("Read-only access");
        expect([...container.querySelectorAll("button")].some(button => ["Start", "Stop", "Restart", "Update now"].includes(button.textContent ?? ""))).toBe(false);
    } finally { await act(async () => root.unmount()); }
});

it("does not render a historical succeeded receipt or hide controls after a reload", async () => {
    const container = document.createElement("div"); const root = createRoot(container);
    const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: null, allowedActions: ["stop", "restart-game"],
        crashLoopDetected: false, failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null,
        start: { action: "start", jobId: progressJobId, state: "succeeded", phase: "ready", progress: "Server started and ready to join.",
            attemptCount: 1, maximumAttempts: 5, nextRetryAt: null, stoppedRetrying: false, failureCode: null, recommendedAction: null } };
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} operationState="running" observedGameState="running" runtimeInsight={insight} /></TestLocalization>));
        expect(container.textContent).not.toContain("Your server is ready to join");
        expect(container.querySelector("ol")).toBeNull();
        expect([...container.querySelectorAll("button")].find(button => button.textContent === "Stop")?.disabled).toBe(false);
    } finally { await act(async () => root.unmount()); }
});

it.each(["running", "failed", "cancelled"] as const)("names an adopted %s restart receipt as Restart", async state => {
    const container = document.createElement("div"); const root = createRoot(container);
    const receipt = { action: "restart-game" as const, jobId: progressJobId, state,
        phase: state === "running" ? "preparing" as const : state, progress: "Restart receipt.",
        attemptCount: 1, maximumAttempts: 5, nextRetryAt: null, stoppedRetrying: state !== "running",
        failureCode: state === "failed" ? "operation_failed" as const : null, recommendedAction: null };
    const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: null, allowedActions: [],
        crashLoopDetected: false, failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: receipt };
    startStatus.mockReset().mockResolvedValue({ serverId: progressServerId, ...receipt });
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="starting" runtimeInsight={insight} /></TestLocalization>));
        expect(container.textContent).toContain(state === "running" ? "Restarting your server" : state === "failed" ? "Server could not restart" : "Restart cancelled");
        expect(container.textContent).not.toContain("Starting your server");
    } finally { await act(async () => root.unmount()); }
});

it("restores a mounted terminal receipt after an unrelated Update request", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    requestUpdate.mockReset().mockResolvedValue({ outcome: "queued" });
    const container = document.createElement("div"); const root = createRoot(container);
    const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: null, allowedActions: ["stop"],
        crashLoopDetected: false, failureCode: "operation_failed", recommendedAction: "contact-support",
        failureMessage: "Server status needs attention.", recommendation: null, start: {
            action: "start", jobId: progressJobId, state: "failed", phase: "failed", progress: "Attempt 5 of 5.",
            attemptCount: 5, maximumAttempts: 5, nextRetryAt: null, stoppedRetrying: true,
            failureCode: "operation_failed", recommendedAction: "contact-support",
        } };
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="failed" operationState="failed" runtimeInsight={insight} /></TestLocalization>));
        const update = [...container.querySelectorAll("button")].find(button => button.textContent === "Update now")!;
        await act(async () => update.click());
        expect(container.textContent).toContain("Attempt 5 of 5");
    } finally { await act(async () => root.unmount()); vi.restoreAllMocks(); }
});

it("keeps a locally followed failed receipt after its matching summary and a refused Update", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockResolvedValue({ ...progress("failed", "failed", "Attempt 5 of 5."), failureCode: "operation_failed" });
    requestUpdate.mockReset().mockRejectedValue(new MyServersApiError("no_update_available", "No update is available."));
    const container = document.createElement("div"); const root = createRoot(container);
    const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: null, allowedActions: ["stop"],
        crashLoopDetected: false, failureCode: "operation_failed", recommendedAction: "contact-support", failureMessage: "Server status needs attention.", recommendation: null,
        start: { action: "start", jobId: progressJobId, state: "failed", phase: "failed", progress: "Attempt 5 of 5.",
            attemptCount: 5, maximumAttempts: 5, nextRetryAt: null, stoppedRetrying: true, failureCode: "operation_failed", recommendedAction: "contact-support" } };
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="stopped" /></TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="failed" operationState="failed" runtimeInsight={insight} /></TestLocalization>));
        await act(async () => vi.advanceTimersByTimeAsync(1));
        const update = [...container.querySelectorAll("button")].find(button => button.textContent === "Update now")!;
        await act(async () => update.click());
        expect(container.textContent).toContain("Attempt 5 of 5");
    } finally { await act(async () => root.unmount()); vi.restoreAllMocks(); }
});

it.each(["succeeded", "running"] as const)("reveals once when a fast Start's %s receipt arrives and clears stale ready state", async state => {
    vi.useFakeTimers();
    revealAddress.mockClear();
    request.mockReset().mockResolvedValue({ exitCode: 0 });
    startStatus.mockReset().mockResolvedValue(progress("ready", "succeeded", "Ready."));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="stopped" /></TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Your server is ready to join");
        expect(revealAddress).toHaveBeenCalledTimes(1);
        const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: null, allowedActions: ["stop", "restart-game"],
            crashLoopDetected: false, failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: {
                action: "start", jobId: progressJobId, state, phase: state === "succeeded" ? "ready" : "verifying", progress: "Ready.",
                attemptCount: 1, maximumAttempts: 5, nextRetryAt: null, stoppedRetrying: false, failureCode: null, recommendedAction: null,
            } };
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} operationState="running" observedGameState="running" runtimeInsight={insight} /></TestLocalization>));
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(container.textContent).toContain("Your server is ready to join");
        // A later receipt must respect the owner hiding the address after the first reveal.
        expect(revealAddress).toHaveBeenCalledTimes(1);
        const failed: OwnerRuntimeInsight = { ...insight, start: null, failureCode: "game_crashed_during_load", recommendedAction: "review-backups",
            failureMessage: "The campaign failed.", recommendation: "Review recovery.", allowedActions: ["stop"] };
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} expectedUpdatedAt="2026-09-20T12:01:00.000Z"
            operationState="failed" observedGameState="failed" runtimeInsight={failed} /></TestLocalization>));
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(container.textContent).not.toContain("Your server is ready to join");
        expect(container.textContent).toContain("The campaign failed.");
    } finally { await act(async () => root.unmount()); }
});

it.each(["admin", "support"] as const)("does not poll an active receipt for read-only %s", async accessRole => {
    startStatus.mockClear();
    const container = document.createElement("div"); const root = createRoot(container);
    const insight: OwnerRuntimeInsight = { desiredState: "running", observedAt: null, allowedActions: [],
        crashLoopDetected: false, failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: {
            action: "start", jobId: progressJobId, state: "running", phase: "starting", progress: "Loading.",
            attemptCount: 1, maximumAttempts: 5, nextRetryAt: null, stoppedRetrying: false, failureCode: null, recommendedAction: null,
        } };
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} accessRole={accessRole} observedGameState="starting" runtimeInsight={insight} /></TestLocalization>));
        expect(startStatus).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
});

it("follows the accepted Start through real phases and readiness without sending Start again", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockResolvedValueOnce(progress("preparing", "running", "Creating a safe restore point"))
        .mockResolvedValueOnce(progress("starting", "running", "Loading your campaign"))
        .mockResolvedValueOnce(progress("verifying", "running", "Checking readiness"))
        .mockResolvedValue(progress("ready", "succeeded", "Server started and ready to join."));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Creating a safe restore point");
        expect(container.querySelectorAll("ol li")).toHaveLength(5);
        expect(container.querySelector("button")!.disabled).toBe(true);
        for (const [phase, label] of [["starting", "Loading your campaign"], ["verifying", "Checking readiness"], ["ready", "Your server is ready to join"]]) {
            await act(async () => vi.advanceTimersByTimeAsync(2_000));
            expect(container.textContent).toContain(label);
            expect(container.querySelector('[aria-current="step"]')?.textContent).toContain(phase === "starting" ? "Launch game" : phase === "verifying" ? "Confirm readiness" : "Ready to join");
        }
        expect(container.textContent).toContain("Connect with the IP address on the top right of this webpage.");
        expect(startStatus).toHaveBeenCalledWith("token", progressServerId, progressJobId);
        expect(request).toHaveBeenCalledTimes(1);
        const calls = startStatus.mock.calls.length;
        await act(async () => vi.advanceTimersByTimeAsync(10_000));
        expect(startStatus).toHaveBeenCalledTimes(calls);
        expect(router.refresh).toHaveBeenCalled();
        expect(container.querySelectorAll("button")[0].disabled).toBe(true);
        expect(container.querySelectorAll("button")[1].disabled).toBe(false);
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} operationState="stopped" expectedUpdatedAt="2026-09-20T12:01:00.000Z" />} </TestLocalization>));
        expect(container.querySelectorAll("button")[0].disabled).toBe(false);
    } finally { await act(async () => root.unmount()); }
});

it.each(["failed", "cancelled"])("stops following a %s Start without claiming readiness", async (state) => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockResolvedValue(progress("starting", state, "The campaign did not finish loading."));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain(state === "failed" ? "Server could not start" : "Start cancelled");
        expect(container.textContent).not.toContain("Your server is ready to join");
        expect(container.textContent).toContain("The campaign did not finish loading.");
        expect(container.textContent).not.toContain("You can press Start to try again.");
        expect(container.textContent).not.toContain("contact support");
        expect(container.querySelector("button")!.disabled).toBe(false);
        expect(container.querySelector(".animate-spin")).toBeNull();
        await act(async () => vi.advanceTimersByTimeAsync(10_000));
        expect(startStatus).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
});

it("clears local failed progress when a newer summary confirms recovery and clears the receipt", async () => {
    vi.useFakeTimers();
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockResolvedValue({ ...progress("failed", "failed", "Automatic retries stopped."), failureCode: "game_crashed_during_load" });
    const container = document.createElement("div"); const root = createRoot(container);
    const insight: OwnerRuntimeInsight = { desiredState: "stopped", observedAt: null, allowedActions: ["start"],
        crashLoopDetected: false, failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: null };
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="stopped" runtimeInsight={insight} /></TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Server could not start");
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} expectedUpdatedAt="2026-10-02T16:01:00.000Z" operationState="running" observedGameState="running"
            runtimeInsight={{ ...insight, desiredState: "running", allowedActions: ["stop", "restart-game"] }} /></TestLocalization>));
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(container.textContent).not.toContain("Server could not start");
        expect(container.querySelector("ol")).toBeNull();
    } finally { await act(async () => root.unmount()); }
});

it("shows a stopped server's retained mod diagnosis on reload without sending Start", async () => {
    request.mockClear(); startStatus.mockClear();
    const insight: OwnerRuntimeInsight = { desiredState: "stopped", observedAt: null, allowedActions: ["start"], crashLoopDetected: false,
        failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: null,
        modLoadFailure: { modId: "CoopSycn", reason: "missing-assembly", assembly: "0Harmony" } };
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="stopped" runtimeInsight={insight} /></TestLocalization>));
        expect(container.textContent).toContain("Mod CoopSycn could not load the server-provided Harmony (0Harmony.dll). This is a hosting problem; re-uploading Bannerlord.Harmony will not fix it.");
        expect(request).not.toHaveBeenCalled();
        expect(startStatus).not.toHaveBeenCalled();
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} observedGameState="running" runtimeInsight={insight} /></TestLocalization>));
        expect(container.textContent).not.toContain("0Harmony.dll");
    } finally { await act(async () => root.unmount()); }
});

it("names the mod a failed Start could not load, from its recorded diagnosis", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockResolvedValue({ ...progress("starting", "failed", "Mod OffTheClock failed to load."),
        modLoadFailure: { modId: "OffTheClock.RichMerchants", reason: "missing-assembly", assembly: "TaleWorlds.CampaignSystem.ViewModelCollection" } });
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Server could not start");
        expect(container.textContent).toContain("Mod OffTheClock.RichMerchants needs TaleWorlds.CampaignSystem.ViewModelCollection. Upload the dependency or disable this mod in Mods. Then start again.");
        expect(container.textContent).not.toContain("You can press Start to try again.");
    } finally { await act(async () => root.unmount()); }
});

it.each([
    ["mod_load_failed", { modId: "Broken.Mod", reason: "missing-dll" }, "Mod Broken.Mod is missing a DLL listed in SubModule.xml. Upload the complete mod including its bin folder, or disable it in Mods. Then start again."],
    ["mod_load_failed", null, "A custom mod failed to load. Disable recently enabled mods and start again."],
    ["crash_loop_cooldown", null, "The server crashed repeatedly while starting, so Start is paused for about 25 minutes. Changing its enabled mods ends the pause now."],
])("shows a terminal %s Start refusal without following status", async (code, diagnosis, message) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    beginPolling.mockClear();
    const ownerCopy = code === "crash_loop_cooldown" ? message : "A custom mod failed to load. Disable recently enabled mods and start again.";
    request.mockReset().mockRejectedValue(new MyServersApiError(code, ownerCopy, false, progressJobId));
    startStatus.mockReset().mockResolvedValue({ ...progress("starting", "failed", ownerCopy), ...(diagnosis ? { modLoadFailure: diagnosis } : {}) });
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain(message);
        expect(beginPolling).not.toHaveBeenCalled();
        expect(startStatus).toHaveBeenCalledTimes(code === "mod_load_failed" ? 1 : 0);
        expect(container.querySelector("button")!.disabled).toBe(false);
    } finally { await act(async () => root.unmount()); }
});

it("reconnects progress reads, shows retry wait, and resumes the same job after the bounded watch", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockRejectedValueOnce(new Error("private transport details"))
        .mockResolvedValue(progress("starting", "retry-wait", "Loading your campaign"));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Reconnecting to server progress");
        expect(container.textContent).not.toContain("private transport details");
        vi.setSystemTime(Date.now() + 15 * 60_000);
        await act(async () => vi.advanceTimersByTimeAsync(2_000));
        expect(container.textContent).toContain("Waiting to retry safely");
        expect(container.textContent).toContain("Automatic progress updates are paused");
        startStatus.mockResolvedValue(progress("ready", "succeeded"));
        const resume = [...container.querySelectorAll("button")].find(button => button.textContent === "Resume progress updates")!;
        await act(async () => resume.click());
        expect(container.textContent).toContain("Your server is ready to join");
        expect(request).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
});

it("cleans up progress reads when the controls unmount", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockResolvedValue(progress("starting"));
    const container = document.createElement("div"); const root = createRoot(container);
    await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
    await act(async () => container.querySelector("button")!.click());
    await act(async () => root.unmount());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(startStatus).toHaveBeenCalledTimes(1);
});

it("shows progress immediately while the Start response is still pending", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let complete!: () => void;
    request.mockReset().mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => { container.querySelector("button")!.click(); });
        expect(container.textContent).toContain("Starting your server");
        expect(container.textContent).toContain("Sending your Start request");
        expect(container.querySelector("button")!.disabled).toBe(true);
        await act(async () => complete());
        expect(container.textContent).toContain("Your server is ready to join");
    } finally { await act(async () => root.unmount()); }
});

it("pauses progress after access is revoked and keeps readiness unconfirmed", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockRejectedValue(new MyServersApiError("forbidden", "Private authority details"));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Your server access could not be confirmed");
        expect(container.textContent).toContain("Readiness has not been confirmed");
        expect(container.textContent).not.toContain("Private authority details");
        expect(container.querySelector(".animate-spin")).toBeNull();
        await act(async () => vi.advanceTimersByTimeAsync(10_000));
        expect(startStatus).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
});

it.each(["server", "network"])("checks server status after an unconfirmed Start (%s) instead of asking the owner to", async (failure) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset();
    beginPolling.mockClear();
    const action = failure === "network" ? vi.spyOn(serverActions, "operateManagedServer").mockRejectedValue(new Error("lost response")) : null;
    request.mockRejectedValue(new MyServersApiError("container_command_unavailable", "Private transport details"));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("We couldn’t confirm that your Start request went through, so we’re checking your server’s status…");
        expect(container.textContent).not.toContain("Refresh server status");
        expect(container.textContent).not.toContain("Private transport details");
        expect(beginPolling).toHaveBeenCalledExactlyOnceWith(progressServerId, progressProps.expectedUpdatedAt);
    } finally {
        await act(async () => root.unmount());
        action?.mockRestore();
    }
});

it("refreshes status automatically when Update now finds a changed server, without retrying it", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requestUpdate.mockReset().mockRejectedValue(new MyServersApiError("stale_interaction", "Stale"));
    router.refresh.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="running" {...progressProps} operationState="running" />} </TestLocalization>));
        await act(async () => container.querySelectorAll("button")[3].click());
        expect(container.textContent).toContain("Your server’s status changed, so we refreshed it. Press Update now again to continue.");
        expect(router.refresh).toHaveBeenCalledOnce();
        expect(requestUpdate).toHaveBeenCalledOnce();
        expect(container.querySelectorAll("button")[3].disabled).toBe(false);
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

it("moves Update now and its feedback into the Maintenance card beside the log download", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requestUpdate.mockReset().mockRejectedValue(new MyServersApiError("stale_interaction", "Stale"));
    router.refresh.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerMaintenanceProvider>
            <div data-console><ManagedServerControls observedGameState="running" {...progressProps} operationState="running" /></div>
            <ManagedServerMaintenance serverId={progressServerId} userId="owner" canUpdate releaseChannel="stable" />
        </ManagedServerMaintenanceProvider></TestLocalization>));
        const card = container.querySelector('section[aria-labelledby="server-maintenance-heading"]')!;
        const consoleControls = container.querySelector("[data-console]")!;
        const update = [...card.querySelectorAll("button")].find(button => button.textContent === "Update now")!;
        expect(card.textContent).toContain("Installs the latest Stable release now.");
        expect([...card.querySelectorAll("button")].map(button => button.textContent)).toEqual(["Update now", "Download logs"]);
        expect([...consoleControls.querySelectorAll("button")].map(button => button.textContent)).toEqual(["Start", "Stop", "Restart"]);
        await act(async () => update.click());
        expect(card.textContent).toContain("Your server’s status changed, so we refreshed it. Press Update now again to continue.");
        expect(consoleControls.textContent).not.toContain("Your server’s status changed");
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

it("shows Restart progress immediately, then explains the wait when no live console can confirm it", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let complete!: (value: { exitCode: number }) => void;
    request.mockReset().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    beginPolling.mockClear();
    router.refresh.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="running" {...progressProps} operationState="running" />} </TestLocalization>));
        await act(async () => { container.querySelectorAll("button")[2].click(); });
        expect(container.textContent).toContain("Restarting your server…");
        expect(container.textContent).toContain("Sending your Restart request…");
        expect(container.querySelector('[aria-current="step"]')!.textContent).toContain("Restart requested");
        expect([...container.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
        await act(async () => complete({ exitCode: 0 }));
        expect(container.textContent).toContain("Restarting. Players can rejoin once the campaign finishes loading, usually within a couple of minutes.");
        expect(container.textContent).not.toContain("code 0");
        expect(container.querySelector("ol")).toBeNull();
        expect(container.querySelectorAll("button")[2].disabled).toBe(false);
        expect(beginPolling).not.toHaveBeenCalled();
        expect(router.refresh).toHaveBeenCalledOnce();
        expect(request).toHaveBeenCalledExactlyOnceWith("token", { serverId: progressServerId, action: "restart-game" });
    } finally {
        await act(async () => root.unmount());
        confirm.mockRestore();
    }
});

it("renders lifecycle progress in the console toolbar's status row when one is provided", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockImplementation(() => new Promise(() => {}));
    const slot = document.createElement("div");
    statusSlot.current = slot;
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" {...progressProps} />} </TestLocalization>));
        // The stopped-server guidance now shares the status row with progress, so assert on progress rather than emptiness.
        expect(slot.querySelector("ol")).toBeNull();
        await act(async () => { container.querySelector("button")!.click(); });
        expect(slot.textContent).toContain("Starting your server");
        expect(slot.querySelector("ol")).not.toBeNull();
        expect(container.querySelector("ol")).toBeNull();
        expect(container.textContent).not.toContain("Starting your server");
    } finally {
        await act(async () => root.unmount());
        statusSlot.current = undefined;
    }
});

it.each([
    ["moving", true],
    ["returning", true],
    ["scheduled", false],
    ["starting", false],
] as const)("explains lifecycle controls held by a %s move to a new machine: unavailable=%s", async (state, unavailable) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const serverId = "22222222-2222-4222-8222-222222222222";
    const move: MyServerMove = { state, scheduledAt: "2026-10-19T03:00:00.000Z", startedAt: unavailable ? "2026-10-19T03:01:00.000Z" : null,
        completedAt: null, step: state === "moving" ? "restoring" : null, address: null, stayedOnOriginal: null };
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerMoveProvider serverId={serverId} initialMove={move}>
            <ManagedServerControls serverId={serverId} displayName="Campaign" accessRole="owner" operationState="running" observedGameState="running" expectedUpdatedAt="2026-09-20T12:00:00.000Z" />
        </ManagedServerMoveProvider></TestLocalization>));
        const buttons = Object.fromEntries([...container.querySelectorAll("button")].map(button => [button.textContent, button.disabled]));
        expect(buttons).toEqual({ Start: true, Stop: unavailable, Restart: unavailable, "Update now": unavailable });
        const hint = container.querySelector('[role="tooltip"]');
        expect(hint?.textContent ?? null).toBe(unavailable ? "Unavailable while your server moves to a new machine" : null);
    } finally { await act(async () => root.unmount()); }
});

it("forgets one server's move when the page changes to another server", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const first = "22222222-2222-4222-8222-222222222222";
    const second = "33333333-3333-4333-8333-333333333333";
    const moving: MyServerMove = { state: "moving", scheduledAt: null, startedAt: "2026-10-19T03:01:00.000Z", completedAt: null,
        step: "restoring", address: null, stayedOnOriginal: null };
    const moved: MyServerMove = { ...moving, state: "moved", step: null, completedAt: "2026-10-19T03:20:00.000Z", address: "203.0.113.20:4201" };
    const container = document.createElement("div");
    const root = createRoot(container);
    // The same page component renders each server, as a client navigation between two server pages does.
    const render = (serverId: string, initialMove: MyServerMove | null) => act(async () => root.render(<TestLocalization>
        <ManagedServerMoveProvider serverId={serverId} initialMove={initialMove}>
            <ManagedServerMoveStatus notices={[]} />
            <ManagedServerControls serverId={serverId} displayName="Campaign" accessRole="owner" operationState="running" observedGameState="running" expectedUpdatedAt="2026-09-20T12:00:00.000Z" />
        </ManagedServerMoveProvider></TestLocalization>));
    const stop = () => [...container.querySelectorAll("button")].find(button => button.textContent === "Stop")!;
    try {
        await render(first, moving);
        expect(container.querySelector("h2")?.textContent).toBe("Your server is moving to a new machine");
        expect(stop().disabled).toBe(true);

        // The other server has no move, and its move-status read fails, so nothing may carry the first server's move over.
        await render(second, null);
        expect(container.querySelector("section")).toBeNull();
        expect(container.querySelector('[role="tooltip"]')).toBeNull();
        expect(stop().disabled).toBe(false);

        // Back on the first server, its own freshly rendered status is shown.
        await render(first, moved);
        expect(container.querySelector("h2")?.textContent).toBe("Your server moved to a new machine");
        expect(stop().disabled).toBe(false);
    } finally { await act(async () => root.unmount()); }
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

it.each([
    ["sleeper", "running", ["start", "stop"]],
    ["sleeper without Stop admission", "running", ["start"]],
    ["admin hold", "stopped", []],
    ["subscription hold", "stopped", []],
    ["held with running intent", "running", []],
] as const)("keeps allowedActions authoritative for %s", async (name, desiredState, allowedActions) => {
    const container = document.createElement("div"); const root = createRoot(container);
    const insight: OwnerRuntimeInsight = { desiredState, allowedActions: [...allowedActions], observedAt: null,
        crashLoopDetected: false, failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: null };
    try {
        await act(async () => root.render(<TestLocalization><ManagedServerControls {...progressProps} operationState="suspended"
            observedGameState="stopped" runtimeInsight={insight} subscriptionHold={name === "subscription hold" ? { reason: "subscription-funding-lapsed" } : null} /></TestLocalization>));
        for (const action of ["start", "stop"] as const) {
            const button = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === (action === "start" ? "Start" : "Stop"))!;
            expect(button).toBeDefined();
            expect(button.disabled).toBe(!insight.allowedActions.includes(action));
        }
    } finally { await act(async () => root.unmount()); }
});
