import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as serverActions from "@/app/servers/managed-server-actions";
import { ManagedServerControls, ManagedServerPassword } from "./ManagedServerControls";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const { request, requestUpdate, requestPassword, beginPolling, startStatus, router, statusSlot } = vi.hoisted(() => ({ request: vi.fn(), requestUpdate: vi.fn(), requestPassword: vi.fn(), beginPolling: vi.fn(), startStatus: vi.fn(), router: { refresh: vi.fn() }, statusSlot: { current: undefined as HTMLElement | null | undefined } }));
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
    useManagedServerPolling: () => ({ session: null, timedOutSession: null, beginPolling, endPolling: vi.fn() }),
    useManagedConsoleSignals: () => null,
    useManagedServerStatusSlot: () => statusSlot.current,
}));

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
        await act(async () => root.render(<TestLocalization>{<ManagedServerControls observedGameState="stopped" serverId="22222222-2222-4222-8222-222222222222"
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
        expect(container.textContent).toContain("The campaign did not finish loading. You can press Start to try again.");
        expect(container.textContent).not.toContain("contact support");
        expect(container.querySelector("button")!.disabled).toBe(false);
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
        expect(slot.childElementCount).toBe(0);
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

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
