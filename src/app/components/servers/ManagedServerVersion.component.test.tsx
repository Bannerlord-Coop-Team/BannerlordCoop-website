import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BuildChangeJob, BuildOptions, BuildStatus } from "../../../../supabase/functions/_shared/server-build-contract";
import { ManagedServerVersion } from "./ManagedServerVersion";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";

const { actions, router } = vi.hoisted(() => ({
    actions: { change: vi.fn(), options: vi.fn(), status: vi.fn() },
    router: { refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/servers/server-build-actions", () => ({
    changeServerBuild: actions.change, readServerBuildOptions: actions.options, readServerBuildStatus: actions.status,
}));

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const updatedAt = "2026-10-30T12:00:00.000Z";
const option = (buildId: string, extra: Partial<BuildOptions["options"][number]> = {}) => ({
    buildId, version: buildId, isLatest: false, isInstalled: false, isPinned: false, direction: "older" as const,
    saveCompatibility: "unverified" as const, requiresSaveAcknowledgement: true, ...extra,
});
const options = (extra: Partial<BuildOptions> = {}): BuildOptions => ({
    serverId, updatedAt, releaseChannel: "stable", selectable: true, unavailableReason: null, installedVersion: "v0.1.10",
    pinnedVersion: null, latestVersion: "v0.1.10",
    options: [option("v0.1.10", { isLatest: true, isInstalled: true, direction: "same", requiresSaveAcknowledgement: false }), option("v0.1.9"), option("v0.1.8")], ...extra,
});
const stepNames = ["queued", "stopping", "backup", "installing", "starting", "verifying"] as const;
const job = (states: BuildChangeJob["steps"][number]["state"][], extra: Partial<BuildChangeJob> = {}): BuildChangeJob => ({
    jobId, state: "running", initiatedBy: "owner", ownerSelected: true, phase: "backup",
    steps: stepNames.map((id, index) => ({ id, state: states[index] ?? "pending" })),
    completedSteps: states.filter(state => state === "done").length, totalSteps: 6, targetVersion: "v0.1.9", previousVersion: "v0.1.10",
    progress: "Creating a safe restore point", backup: null, rolledBack: false, failureCode: null, failureMessage: null, nextStep: null,
    attemptCount: 1, maximumAttempts: 3, nextRetryAt: null, createdAt: updatedAt, updatedAt, completedAt: null, ...extra,
});
const noJob: BuildStatus = { serverId, job: null };

let container: HTMLDivElement;
let root: Root;
const buttons = () => [...container.querySelectorAll("button")];
const button = (name: string) => buttons().find(candidate => candidate.textContent?.includes(name));
const radio = (value: string) => container.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`)!;

async function render(props: Partial<{ canEdit: boolean; expectedUpdatedAt: string }> = {}) {
    await act(async () => root.render(<TestLocalization><ManagedServerVersion serverId={serverId} expectedUpdatedAt={props.expectedUpdatedAt ?? updatedAt} canEdit={props.canEdit ?? true} /></TestLocalization>));
}
const choose = (value: string) => act(async () => { radio(value).click(); });

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    actions.change.mockReset(); actions.options.mockReset(); actions.status.mockReset(); router.refresh.mockClear();
    actions.options.mockResolvedValue(options());
    actions.status.mockResolvedValue(noJob);
    container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it("renders nothing without edit access, without a selectable build list, or while the control plane lacks the read", async () => {
    await render({ canEdit: false });
    expect(container.textContent).toBe("");
    expect(actions.options).not.toHaveBeenCalled();
    actions.options.mockResolvedValue(null);
    await render();
    expect(container.textContent).toBe("");
    actions.options.mockResolvedValue(options({ selectable: false, unavailableReason: "nightly-channel", options: [] }));
    await render({ expectedUpdatedAt: "2026-10-30T12:01:00.000Z" });
    expect(container.textContent).toBe("");
});

it("shows what runs, offers Latest and earlier public versions, and keeps the confirmation hidden until a change is chosen", async () => {
    await render();
    expect(container.textContent).toContain("Running v0.1.10");
    expect(container.textContent).toContain("Following Latest");
    expect(radio("latest").checked).toBe(true);
    expect([...container.querySelectorAll("input[type=radio]")].map(input => (input as HTMLInputElement).value)).toEqual(["latest", "v0.1.9", "v0.1.8"]);
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.textContent).toContain("Compatibility with your current campaign has not been verified.");
});

it("warns plainly about save compatibility and requires acknowledgement before an older version can be installed", async () => {
    actions.change.mockResolvedValue({ ok: true, outcome: "enqueued", jobId, message: "Version change queued. Follow its progress below." });
    await render();
    await choose("v0.1.9");
    const confirm = container.querySelector('[role="group"]')!;
    expect(confirm.textContent).toContain("Install v0.1.9?");
    expect(confirm.textContent).toContain("Older versions may not load newer saves");
    expect(confirm.textContent).toContain("Your campaign was last saved by v0.1.10. v0.1.9 has not been verified to read it");
    expect(confirm.textContent).toContain("A backup is created first and kept under Backups");
    expect(confirm.textContent).toContain("returned to v0.1.10 automatically");
    expect(confirm.textContent).toContain("Automatic updates are paused for this server until you select Latest.");
    expect(button("Install v0.1.9")!.disabled).toBe(true);
    await act(async () => { container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click(); });
    expect(button("Install v0.1.9")!.disabled).toBe(false);
    actions.status.mockResolvedValue({ serverId, job: job(["done", "active"]) });
    await act(async () => { button("Install v0.1.9")!.click(); });
    expect(actions.change).toHaveBeenCalledExactlyOnceWith({
        serverId, buildId: "v0.1.9", expectedUpdatedAt: updatedAt, acknowledgeSaveRisk: true, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(container.textContent).toContain("Version change queued. Follow its progress below.");
    expect(container.querySelector('[role="group"]')).toBeNull();
});

it("shows each phase of the change with a progress bar, the restore point and the live step", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "active"], { backup: { backupId: jobId } }) });
    await render();
    const progress = container.querySelector('[role="progressbar"]')!;
    expect(progress.getAttribute("aria-valuenow")).toBe("2");
    expect(progress.getAttribute("aria-valuemax")).toBe("6");
    expect(progress.getAttribute("aria-valuetext")).toBe("Step 3 of 6: Creating a backup");
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Creating a backup");
    expect([...container.querySelectorAll("ol li")].map(item => item.textContent)).toEqual([
        "QueuedDone", "Saving and stopping the gameDone", "Creating a backupIn progress", "Installing v0.1.9Waiting",
        "Starting the gameWaiting", "Checking that the server is readyWaiting",
    ]);
    expect(container.textContent).toContain("Changing to v0.1.9");
    expect(container.textContent).toContain("A backup was created before the change. You can restore it any time from Backups.");
    // The group of choices is locked while the change runs.
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
});

it("follows a running change until it ends, then refreshes the page and the offered versions", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "active"]) });
    await render();
    expect(router.refresh).not.toHaveBeenCalled();
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "done", "done", "done"], { state: "succeeded", phase: "done", progress: "Now running v0.1.9.", completedAt: updatedAt }) });
    actions.options.mockResolvedValue(options({ installedVersion: "v0.1.9", pinnedVersion: "v0.1.9", options: [option("v0.1.10", { isLatest: true, direction: "newer", requiresSaveAcknowledgement: false }), option("v0.1.9", { isInstalled: true, isPinned: true, direction: "same", requiresSaveAcknowledgement: false })] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Now running v0.1.9.");
    expect(container.textContent).toContain("Automatic updates are paused. Select Latest to resume them.");
    expect(container.textContent).toContain("Automatic updates are paused. This server stays on v0.1.9 until you select Latest.");
    expect(container.querySelector('[role="progressbar"]')!.getAttribute("aria-valuetext")).toBe("Complete");
});

it("reports a failed change with its reason, the automatic return and the next step", async () => {
    actions.status.mockResolvedValue({ serverId, job: job(["done", "done", "done", "failed"], { state: "failed", phase: "failed", rolledBack: true, failureCode: "agent_game_health_failed",
        failureMessage: "The game did not start on the selected version. We returned your server to v0.1.10. Your campaign and the backup taken before the change are intact.",
        nextStep: "Check that your campaign and enabled mods work on that version, then try again or choose another version.", backup: { backupId: jobId } }) });
    actions.change.mockResolvedValue({ ok: true, outcome: "enqueued", jobId, message: "Version change queued." });
    await render();
    // Older failures are history; only a change this page requested or followed is reported.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await choose("v0.1.9");
    await act(async () => { container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click(); });
    await act(async () => { button("Install v0.1.9")!.click(); });
    const alert = [...container.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes("did not finish"))!;
    expect(alert.textContent).toContain("We returned your server to v0.1.10");
    expect(alert.textContent).toContain("then try again or choose another version");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect([...container.querySelectorAll("ol li")][3].textContent).toBe("Installing v0.1.9Failed");
});

it("returns to Latest from a pin and resumes automatic updates without asking about saves", async () => {
    actions.options.mockResolvedValue(options({ installedVersion: "v0.1.9", pinnedVersion: "v0.1.9", latestVersion: "v0.1.11",
        options: [option("v0.1.11", { isLatest: true, direction: "newer", requiresSaveAcknowledgement: false }), option("v0.1.9", { isInstalled: true, isPinned: true, direction: "same", requiresSaveAcknowledgement: false })] }));
    actions.change.mockResolvedValue({ ok: true, outcome: "enqueued", jobId, message: "Version change queued. Follow its progress below." });
    await render();
    expect(container.textContent).toContain("Latest available: v0.1.11");
    expect(radio("v0.1.9").checked).toBe(true);
    await choose("latest");
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.textContent).toContain("Return to the latest version?");
    expect(container.textContent).toContain("Automatic updates resume for future releases after this change.");
    await act(async () => { button("Return to Latest")!.click(); });
    expect(actions.change).toHaveBeenCalledWith(expect.objectContaining({ buildId: null, acknowledgeSaveRisk: false }));
});

it("pins the running version without a restart and refreshes at once", async () => {
    actions.options.mockResolvedValue(options({ latestVersion: "v0.1.11", options: [option("v0.1.11", { isLatest: true, direction: "newer", requiresSaveAcknowledgement: false }), option("v0.1.10", { isInstalled: true, direction: "same", requiresSaveAcknowledgement: false })] }));
    actions.change.mockResolvedValue({ ok: true, outcome: "pinned", jobId: null, message: "v0.1.10 is now selected. Automatic updates are paused until you select Latest." });
    await render();
    await choose("v0.1.10");
    expect(container.textContent).toContain("Stay on v0.1.10");
    expect(container.textContent).toContain("This does not restart the server.");
    await act(async () => { button("Stay on v0.1.10")!.click(); });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("is now selected. Automatic updates are paused");
});

it("keeps one request identity for a retry and releases it after a definitive refusal", async () => {
    actions.change.mockResolvedValueOnce({ ok: false, rejected: false, message: "The version change could not be confirmed. Check its progress or try again." })
        .mockResolvedValueOnce({ ok: false, rejected: true, message: "That version is no longer available. Refresh the page and choose another." })
        .mockResolvedValue({ ok: false, rejected: true, message: "x" });
    await render();
    await choose("v0.1.9");
    await act(async () => { container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click(); });
    await act(async () => { button("Install v0.1.9")!.click(); });
    await act(async () => { button("Install v0.1.9")!.click(); });
    const [first, second] = actions.change.mock.calls.map(([input]) => (input as { requestId: string }).requestId);
    expect(first).toBe(second);
    expect(container.textContent).toContain("no longer available");
    await act(async () => { button("Install v0.1.9")!.click(); });
    expect((actions.change.mock.calls[2]![0] as { requestId: string }).requestId).not.toBe(first);
});
