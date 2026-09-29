import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import * as serverActions from "@/app/servers/managed-server-actions";
import { ManagedServerControls } from "./ManagedServerControls";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const { request, requestUpdate, requestPassword, beginPolling } = vi.hoisted(() => ({ request: vi.fn(), requestUpdate: vi.fn(), requestPassword: vi.fn(), beginPolling: vi.fn() }));
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
    [null, "command exited successfully (code 0)"],
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
        await act(async () => root.render(<ManagedServerControls serverId={serverId} displayName="Campaign"
            accessRole="owner" operationState="stopped" expectedUpdatedAt="2026-09-20T12:00:00.000Z" />));
        await act(async () => container.querySelector("button")!.click());
        expect(container.textContent).toContain(message);
        expect(beginPolling).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledExactlyOnceWith("token", { serverId, action: "start" });
    } finally { await act(async () => root.unmount()); }
});

it("warns that direct Stop/Restart can lose unsaved progress and respects cancellation", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<ManagedServerControls serverId="22222222-2222-4222-8222-222222222222"
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
        await act(async () => root.render(<ManagedServerControls serverId="22222222-2222-4222-8222-222222222222"
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
        await act(async () => root.render(<ManagedServerControls serverId={serverId} displayName="Campaign" accessRole="owner" operationState="stopped" expectedUpdatedAt="2026-09-28T00:00:00.000Z" />));
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
        await act(async () => root.render(<ManagedServerControls serverId={serverId} displayName="Campaign" accessRole="owner" operationState={cancelled ? "running" : "stopped"} expectedUpdatedAt="2026-09-28T00:00:00.000Z" />));
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
