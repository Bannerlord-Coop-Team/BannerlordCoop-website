import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BuildChangeJob, BuildStatus } from "../../../../supabase/functions/_shared/server-build-contract";
import { ManagedServerVersion } from "./ManagedServerVersion";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";

const { actions, router } = vi.hoisted(() => ({
    actions: { status: vi.fn() },
    router: { refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/servers/server-build-actions", () => ({ readServerBuildStatus: actions.status }));

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const updatedAt = "2026-10-30T12:00:00.000Z";
const stepNames = ["queued", "stopping", "backup", "installing", "starting", "verifying"] as const;
const job = (states: BuildChangeJob["steps"][number]["state"][], extra: Partial<BuildChangeJob> = {}): BuildChangeJob => ({
    jobId, state: "running", initiatedBy: "automatic", ownerSelected: false, phase: "backup",
    steps: stepNames.map((id, index) => ({ id, state: states[index] ?? "pending" })),
    completedSteps: states.filter(state => state === "done").length, totalSteps: 6, targetVersion: "0.1.11", previousVersion: "0.1.10",
    progress: "Creating a safe restore point", backup: null, rolledBack: false, failureCode: null, failureMessage: null, nextStep: null,
    attemptCount: 1, maximumAttempts: 3, nextRetryAt: null, createdAt: updatedAt, updatedAt, completedAt: null, ...extra,
});
const noJob: BuildStatus = { serverId, job: null };

let container: HTMLDivElement;
let root: Root;

async function render(props: Partial<{ canEdit: boolean; expectedUpdatedAt: string }> = {}) {
    await act(async () => root.render(<TestLocalization><ManagedServerVersion serverId={serverId} expectedUpdatedAt={props.expectedUpdatedAt ?? updatedAt} canEdit={props.canEdit ?? true} /></TestLocalization>));
}

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    actions.status.mockReset(); router.refresh.mockClear();
    actions.status.mockResolvedValue(noJob);
    container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it("renders nothing without edit access, while no update runs, or while progress cannot be read", async () => {
    await render({ canEdit: false });
    expect(container.textContent).toBe("");
    expect(actions.status).not.toHaveBeenCalled();
    await render();
    expect(container.textContent).toBe("");
    actions.status.mockResolvedValue(null);
    await render({ expectedUpdatedAt: "2026-10-30T12:01:00.000Z" });
    expect(container.textContent).toBe("");
    // An older outcome is history, not a running update.
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "done", "done", "done"], { state: "succeeded", phase: "done" }) });
    await render({ expectedUpdatedAt: "2026-10-30T12:02:00.000Z" });
    expect(container.textContent).toBe("");
});

it("offers no version choice because servers always run their release channel's current build", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "active"]) });
    await render();
    expect(container.textContent).toContain("Server version");
    expect(container.querySelector("input[type=radio]")).toBeNull();
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.textContent).not.toMatch(/Latest|Public versions|Install 0|Stay on|paused/u);
});

it("shows each phase of the update with a progress bar, the restore point and the live step", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "active"], { backup: { backupId: jobId } }) });
    await render();
    const progress = container.querySelector('[role="progressbar"]')!;
    expect(progress.getAttribute("aria-valuenow")).toBe("2");
    expect(progress.getAttribute("aria-valuemax")).toBe("6");
    expect(progress.getAttribute("aria-valuetext")).toBe("Step 3 of 6: Creating a backup");
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Creating a backup");
    expect([...container.querySelectorAll("ol li")].map(item => item.textContent)).toEqual([
        "QueuedDone", "Saving and stopping the gameDone", "Creating a backupIn progress", "Installing 0.1.11Waiting",
        "Starting the gameWaiting", "Checking that the server is readyWaiting",
    ]);
    expect(container.textContent).toContain("Automatic update to 0.1.11");
    expect(container.textContent).toContain("A backup was created before the change. You can restore it any time from Backups.");
});

it("follows a running update until it ends, then refreshes the page", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "active"]) });
    await render();
    expect(router.refresh).not.toHaveBeenCalled();
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "done", "done", "done"], { state: "succeeded", phase: "done", progress: "Now running 0.1.11.", completedAt: updatedAt }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Now running 0.1.11.");
    expect(container.textContent).not.toContain("paused");
    expect(container.querySelector('[role="progressbar"]')!.getAttribute("aria-valuetext")).toBe("Complete");
});

it("reports a followed update that failed with its reason, the automatic return and the next step", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "active"]) });
    await render();
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "failed"], { state: "failed", phase: "failed", rolledBack: true, failureCode: "agent_game_health_failed",
        failureMessage: "The game did not start on the new version. We returned your server to 0.1.10. Your campaign and the backup taken before the change are intact.",
        nextStep: "Check that your campaign and enabled mods work on that version, then try again.", backup: { backupId: jobId } }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    const alert = [...container.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes("did not finish"))!;
    expect(alert.textContent).toContain("We returned your server to 0.1.10");
    expect(alert.textContent).toContain("then try again");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect([...container.querySelectorAll("ol li")][3].textContent).toBe("Installing 0.1.11Failed");
});

it("reports unavailable progress with a way to check again while an update is followed", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "active"]) });
    await render();
    actions.status.mockResolvedValue(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    expect(container.textContent).toContain("Progress is unavailable. The change may still be running.");
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "active"]) });
    await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === "Check progress")!.click(); });
    expect(container.textContent).not.toContain("Progress is unavailable");
});

it("renders stopped success, confirmed rollback and needs-support outcomes without exposing job identifiers", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "active"], {
        state: "running", phase: "backup", targetVersion: "0.1.11", previousVersion: "0.1.10",
        progress: "Creating a safe restore point",
    }) });
    await render();
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done"], {
        state: "succeeded", phase: "done", targetVersion: "0.1.11", previousVersion: "0.1.10",
        progress: "Version 0.1.11 is installed. Your server remains stopped.", completedAt: updatedAt,
    }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    expect(container.textContent).toContain("0.1.10");
    expect(container.textContent).toContain("Version 0.1.11 is installed. Your server remains stopped.");
    expect(container.textContent).not.toContain(jobId);
    expect(container.querySelector("ol")?.getAttribute("aria-live")).toBe("polite");
    expect([...container.querySelectorAll("section")].at(-1)?.className).toContain("w-full");

    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "active"], {
        state: "running", phase: "backup", targetVersion: "0.1.11", previousVersion: "0.1.10", progress: "Creating a safe restore point",
    }) });
    await render({ expectedUpdatedAt: "2026-10-30T12:01:00.000Z" });
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "failed"], {
        state: "failed", phase: "failed", rolledBack: true, failureCode: "agent_game_health_failed",
        progress: "The version change did not finish.",
        failureMessage: "The selected release could not be confirmed healthy. We returned your server to 0.1.10. The pre-update backup is available under Backups.",
        nextStep: "Check your campaign and try again.", backup: { backupId: jobId }, completedAt: updatedAt,
    }) });
    await render({ expectedUpdatedAt: "2026-10-30T12:02:00.000Z" });
    expect(container.textContent).toContain("We returned your server to 0.1.10");
    expect(container.textContent).toContain("pre-update backup is available under Backups");
    expect(container.textContent).not.toContain(jobId);

    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "failed"], {
        state: "failed", phase: "failed", rolledBack: false, failureCode: "update_rollback_requires_review",
        progress: "The version change did not finish.", failureMessage: "The return to the previous version could not be confirmed. No pre-update backup is currently confirmed.",
        nextStep: "Contact hosting support before changing versions again.", completedAt: updatedAt,
    }) });
    await render({ expectedUpdatedAt: "2026-10-30T12:03:00.000Z" });
    expect(container.textContent).toContain("Contact hosting support before changing versions again.");
});
