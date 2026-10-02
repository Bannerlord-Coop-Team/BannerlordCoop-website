import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as serverActions from "@/app/servers/managed-server-actions";
import { ManagedServerControls, ManagedServerPassword } from "./ManagedServerControls";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const { request, requestUpdate, requestPassword, beginPolling, startStatus, router } = vi.hoisted(() => ({ request: vi.fn(), requestUpdate: vi.fn(), requestPassword: vi.fn(), beginPolling: vi.fn(), startStatus: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({ getMyServerStartStatus: startStatus }));
afterEach(() => vi.useRealTimers());
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
}));
vi.mock("./ManagedServerPollingProvider", () => ({
    useManagedServerPolling: () => ({ session: null, beginPolling, endPolling: vi.fn() }),
}));

it.each([
    [null, "Server started and game readiness confirmed"],
    ["container_command_unavailable", "It may have executed"],
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
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" serverId={serverId} displayName="Campaign"
            accessRole="owner" operationState="stopped" expectedUpdatedAt="2026-09-20T12:00:00.000Z" />));
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
    expect(result.message).toContain(operationId === undefined ? "may have executed" : "Start accepted");
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

it("warns that direct Stop/Restart can lose unsaved progress and respects cancellation", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" serverId="22222222-2222-4222-8222-222222222222"
            displayName="Campaign" accessRole="owner" operationState="running" expectedUpdatedAt="2026-09-20T12:00:00.000Z" />));
        for (const index of [1, 2]) {
            await act(async () => container.querySelectorAll("button")[index].click());
            expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("Unsaved progress may be lost"));
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
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" serverId="22222222-2222-4222-8222-222222222222"
            displayName="Campaign" accessRole="owner" operationState="running"
            expectedUpdatedAt="2026-09-20T12:00:00.000Z" />));
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

it("sets a private website password once and clears the input", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requestPassword.mockReset().mockResolvedValue({ changed: true, restartQueued: false });
    const container = document.createElement("div"); const root = createRoot(container);
    const serverId = "22222222-2222-4222-8222-222222222222";
    try {
        await act(async () => root.render(<ManagedServerPassword serverId={serverId} accessRole="owner" operationState="stopped" expectedUpdatedAt="2026-09-28T00:00:00.000Z" />));
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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = document.createElement("div"); const root = createRoot(container);
    const serverId = "22222222-2222-4222-8222-222222222222";
    try {
        await act(async () => root.render(<ManagedServerPassword serverId={serverId} accessRole="owner" operationState={cancelled ? "running" : "stopped"} expectedUpdatedAt="2026-09-28T00:00:00.000Z" />));
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
            expect(container.textContent).toContain("could not be confirmed. It may have applied. Refresh server status before trying again.");
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
        await act(async () => root.render(<ManagedServerPassword serverId="22222222-2222-4222-8222-222222222222" accessRole="manager" operationState="running" expectedUpdatedAt="2026-09-28T00:00:00.000Z" />));
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
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" {...progressProps} />));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Creating a safe restore point");
        expect(container.querySelectorAll("ol li")).toHaveLength(5);
        expect(container.querySelector("button")!.disabled).toBe(true);
        for (const [phase, label] of [["starting", "Loading your campaign"], ["verifying", "Checking readiness"], ["ready", "Your server is ready to join"]]) {
            await act(async () => vi.advanceTimersByTimeAsync(2_000));
            expect(container.textContent).toContain(label);
            expect(container.querySelector('[aria-current="step"]')?.textContent).toContain(phase === "starting" ? "Launch game" : phase === "verifying" ? "Confirm readiness" : "Ready to join");
        }
        expect(startStatus).toHaveBeenCalledWith("token", progressServerId, progressJobId);
        expect(request).toHaveBeenCalledTimes(1);
        const calls = startStatus.mock.calls.length;
        await act(async () => vi.advanceTimersByTimeAsync(10_000));
        expect(startStatus).toHaveBeenCalledTimes(calls);
        expect(router.refresh).toHaveBeenCalled();
        expect(container.querySelectorAll("button")[0].disabled).toBe(true);
        expect(container.querySelectorAll("button")[1].disabled).toBe(false);
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" {...progressProps} operationState="stopped" expectedUpdatedAt="2026-09-20T12:01:00.000Z" />));
        expect(container.querySelectorAll("button")[0].disabled).toBe(false);
    } finally { await act(async () => root.unmount()); }
});

it.each(["failed", "cancelled"])("stops following a %s Start without claiming readiness", async (state) => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset().mockRejectedValue(new MyServersApiError("operation_timeout", "Timed out", false, progressJobId));
    startStatus.mockReset().mockResolvedValue(progress("starting", state));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" {...progressProps} />));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain(state === "failed" ? "Server could not start" : "Start cancelled");
        expect(container.textContent).not.toContain("Your server is ready to join");
        expect(container.querySelector(".animate-spin")).toBeNull();
        await act(async () => vi.advanceTimersByTimeAsync(10_000));
        expect(startStatus).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
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
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" {...progressProps} />));
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
    await act(async () => root.render(<ManagedServerControls observedGameState="stopped" {...progressProps} />));
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
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" {...progressProps} />));
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
        await act(async () => root.render(<ManagedServerControls observedGameState="stopped" {...progressProps} />));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain("Your server access could not be confirmed");
        expect(container.textContent).toContain("Readiness has not been confirmed");
        expect(container.textContent).not.toContain("Private authority details");
        expect(container.querySelector(".animate-spin")).toBeNull();
        await act(async () => vi.advanceTimersByTimeAsync(10_000));
        expect(startStatus).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
});
