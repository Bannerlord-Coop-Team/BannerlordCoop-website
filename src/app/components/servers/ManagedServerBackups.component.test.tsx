import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedServerBackups } from "@/app/components/servers/ManagedServerBackups";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import type { MyServerBackupStatus, MyServerBackupSummary, MyServerSummary } from "@/app/lib/control-plane/types";

const { request, authenticate, router, revalidatePath } = vi.hoisted(() => ({
    request: vi.fn(),
    authenticate: vi.fn(),
    router: { refresh: vi.fn() },
    revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: authenticate }));
vi.mock("@/app/lib/hosting/my-servers", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/hosting/my-servers")>(),
    requestMyServerBackupOperation: request,
}));

const server: MyServerSummary = {
    serverId: "22222222-2222-4222-8222-222222222222",
    displayName: "Campaign",
    friendlyRegion: "Europe",
    operationState: "running",
    observedGameState: "running",
    releaseChannel: "stable",
    updatedAt: "2026-09-02T14:45:07.479Z",
    accessRole: "manager",
};
const backup: MyServerBackupSummary = {
    backupId: "33333333-3333-4333-8333-333333333333",
    backupType: "manual",
    byteSize: 1024,
    createdAt: "2026-09-01T14:45:07.479Z",
    retentionExpiresAt: "2026-09-30T14:45:07.479Z",
    restoreState: "available",
    restoredAt: null,
    canRestore: true,
};
const activeStatus: MyServerBackupStatus = {
    serverId: server.serverId,
    updatedAt: server.updatedAt,
    operationState: "maintenance",
    observedGameState: "stopped",
    job: {
        jobId: "44444444-4444-4444-8444-444444444444",
        action: "restore",
        state: "running",
        progress: "Verifying restored save",
        createdAt: server.updatedAt,
        updatedAt: server.updatedAt,
    },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T15:00:00.000Z"));
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    authenticate.mockResolvedValue({ auth: {
        getUser: async () => ({ data: { user: { id: "user" } } }),
        getSession: async () => ({ data: { session: { access_token: "test-only" } } }),
    } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

async function render(
    status: MyServerBackupStatus | null = null,
    backups: MyServerBackupSummary[] = [backup],
    currentServer = server,
) {
    await act(async () => root.render(
        <ManagedServerPollingProvider>
            <ManagedServerBackups server={currentServer} backups={backups} status={status} />
        </ManagedServerPollingProvider>,
    ));
    await advance(0);
}

async function advance(milliseconds: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

function button(label: string) {
    const target = Array.from(container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent === label);
    expect(target, `button: ${label}`).toBeDefined();
    return target!;
}

async function click(label: string) {
    const target = button(label);
    expect(target.disabled).toBe(false);
    await act(async () => target.click());
    await advance(0);
}

describe("ManagedServerBackups action reconciliation", () => {
    it.each([
        "auth-outage", "signed-out", "missing-token", "busy", "rate_limited",
        "unauthenticated", "identity_unavailable", "access_denied", "server_not_found",
    ])("retains the exact lost restore through %s and successful replay", async (rejection) => {
        // Exercise the real server action, not a fabricated retrySameRequest result.
        request.mockRejectedValueOnce(new Error("Accepted response was lost"));
        await render();
        await click("Restore save");
        const original = request.mock.calls[0];
        expect(original[1]).toEqual({
            serverId: server.serverId,
            backupId: backup.backupId,
            action: "restore-backup",
            expectedUpdatedAt: server.updatedAt,
        });
        expect(original[2]).toMatch(/^[0-9a-f-]{36}$/u);

        // Refresh has a different timestamp and no longer contains the original backup.
        await render(null, [], { ...server, updatedAt: "2026-09-02T16:00:00.000Z" });
        if (rejection === "auth-outage") {
            authenticate.mockRejectedValueOnce(new Error("Authentication unavailable"));
        } else if (rejection === "signed-out" || rejection === "missing-token") {
            authenticate.mockResolvedValueOnce({ auth: {
                getUser: async () => ({ data: { user: rejection === "signed-out" ? null : { id: "user" } } }),
                getSession: async () => ({ data: { session: null } }),
            } });
        } else {
            request.mockRejectedValueOnce(new MyServersApiError(rejection, "Rejected before replay"));
        }
        await click("Retry pending request");
        expect(container.textContent).toContain("unconfirmed outcome");
        expect(button("Create backup").disabled).toBe(true);

        request.mockResolvedValueOnce({ outcome: "existing", jobId: activeStatus.job!.jobId, action: "restore" });
        await click("Retry pending request");
        for (const call of request.mock.calls) expect(call).toEqual(original);
        const rejectedBeforeApi = ["auth-outage", "signed-out", "missing-token"].includes(rejection);
        expect(request).toHaveBeenCalledTimes(rejectedBeforeApi ? 2 : 3);
        expect(container.textContent).toContain("That restore request was already accepted.");
        expect(container.textContent).not.toContain("Retry pending request");
    });

    it("clears an intent on a post-replay state rejection", async () => {
        request.mockRejectedValueOnce(new MyServersApiError("backup_build_mismatch", "Incompatible"));
        await render();
        await click("Restore save");
        expect(container.textContent).not.toContain("Retry pending request");
        expect(button("Create backup").disabled).toBe(false);
        expect(container.textContent).toContain("currently installed game and mod version");
    });

    it("retains an uncertain create request through capacity rejection and replay", async () => {
        request.mockRejectedValueOnce(new Error("Accepted response was lost"));
        await render();
        await click("Create backup");
        const original = request.mock.calls[0];
        expect(original[1]).toEqual({ serverId: server.serverId, action: "create-backup", expectedUpdatedAt: server.updatedAt });
        request.mockRejectedValueOnce(new MyServersApiError("busy", "Busy"));
        await click("Retry pending request");
        request.mockResolvedValueOnce({ outcome: "existing", jobId: activeStatus.job!.jobId, action: "backup" });
        await click("Retry pending request");
        expect(request).toHaveBeenCalledTimes(3);
        for (const call of request.mock.calls) expect(call).toEqual(original);
        expect(container.textContent).toContain("That backup request was already accepted.");
        expect(container.textContent).not.toContain("Retry pending request");
    });
});

describe("ManagedServerBackups bounded polling", () => {
    it.each(["backup", "restore"] as const)("resumes a %s job after the deadline and observes completion", async (action) => {
        const status = { ...activeStatus, job: { ...activeStatus.job!, action } };
        await render(status);
        expect(router.refresh).toHaveBeenCalledTimes(1);
        expect(button("Create backup").disabled).toBe(true);
        await advance(60_000);
        expect(container.textContent).toContain("Automatic status updates paused after one minute");
        const refreshesAtDeadline = router.refresh.mock.calls.length;
        await advance(120_000);
        expect(router.refresh).toHaveBeenCalledTimes(refreshesAtDeadline);

        await click("Refresh status and resume updates");
        expect(router.refresh).toHaveBeenCalledTimes(refreshesAtDeadline + 1);
        expect(container.textContent).not.toContain("Automatic status updates paused");
        await advance(4_000);
        expect(router.refresh).toHaveBeenCalledTimes(refreshesAtDeadline + 2);
        await render({ ...status, operationState: "running", observedGameState: "running",
            updatedAt: "2026-09-02T16:00:00.000Z", job: { ...status.job, state: "succeeded" } });
        expect(container.textContent).toContain(action === "backup" ? "Backup completed." : "Save restore completed.");
        expect(button("Create backup").disabled).toBe(false);
        expect(button("Restore save").disabled).toBe(false);
        const refreshesAtCompletion = router.refresh.mock.calls.length;
        await advance(65_000);
        expect(router.refresh).toHaveBeenCalledTimes(refreshesAtCompletion);
        expect(container.textContent).not.toContain("Automatic status updates paused");
    });
});

it.each(["available", "restored", "failed"])("does not misdescribe an expired %s row as a build mismatch", async (restoreState) => {
    await render(null, [{ ...backup, restoreState, canRestore: false,
        retentionExpiresAt: "2026-09-02T14:00:00.000Z" }]);
    expect(button("Restore save").disabled).toBe(true);
    expect(button("Restore save").title).toBe("This backup is currently unavailable for save-only restore.");
    expect(container.textContent).toContain("This backup is currently unavailable for save-only restore.");
    expect(container.textContent).not.toContain("requires a backup from the currently installed");
});

it.each(["support", "admin"] as const)("does not expose backup mutations to %s access", async (accessRole) => {
    await render(null, [backup], { ...server, accessRole });
    expect(container.textContent).toContain("Read-only access");
    expect(container.textContent).not.toContain("Restore save");
    expect(container.textContent).not.toContain("Create backup");
});
