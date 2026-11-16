import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { BuildUpdateJob } from "../../../../supabase/functions/_shared/server-build-contract";
import { ServerUpdateProgress } from "./ServerUpdateProgress";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";

const jobId = "33333333-3333-4333-8333-333333333333";
const updatedAt = "2026-10-30T12:00:00.000Z";
const stepNames = ["queued", "stopping", "backup", "installing", "starting", "verifying"] as const;
const job = (states: BuildUpdateJob["steps"][number]["state"][], extra: Partial<BuildUpdateJob> = {}): BuildUpdateJob => ({
    jobId, state: "running", initiatedBy: "automatic", ownerSelected: false, phase: "backup",
    steps: stepNames.map((id, index) => ({ id, state: states[index] ?? "pending" })),
    completedSteps: states.filter(state => state === "done").length, totalSteps: 6, targetVersion: "0.1.11", previousVersion: "0.1.10",
    progress: "Creating a safe restore point", backup: null, rolledBack: false, failureCode: null, failureMessage: null, nextStep: null,
    attemptCount: 1, maximumAttempts: 3, nextRetryAt: null, createdAt: updatedAt, updatedAt, completedAt: null, ...extra,
});

let container: HTMLDivElement;
let root: Root;

// Renders one update job's progress inside the test localization.
async function render(value: BuildUpdateJob) {
    await act(async () => root.render(<TestLocalization><ServerUpdateProgress job={value} /></TestLocalization>));
}

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); });

it("shows each phase of the update with a progress bar, the restore point and the live step", async () => {
    await render(job(["done", "done", "active"], { backup: { backupId: jobId } }));
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
    expect(container.textContent).toContain("A backup was created before the update. You can restore it any time from Backups.");
    expect(container.querySelector("ol")?.getAttribute("aria-live")).toBe("polite");
});

it("names the install step without a version when the control plane reports none", async () => {
    await render(job(["done", "done", "done", "active"], { initiatedBy: "owner", targetVersion: null, previousVersion: null }));
    expect([...container.querySelectorAll("ol li")][3].textContent).toBe("Installing the updateIn progress");
    expect(container.textContent).toContain("Update progress");
});

it("reports a completed update as complete", async () => {
    await render(job(["done", "done", "done", "done", "done", "done"], { state: "succeeded", phase: "done", progress: "Now running 0.1.11.", completedAt: updatedAt }));
    expect(container.textContent).toContain("Now running 0.1.11.");
    expect(container.querySelector('[role="progressbar"]')!.getAttribute("aria-valuetext")).toBe("Complete");
});

it("reports a failed update with its reason, the automatic return and the next step, without exposing job identifiers", async () => {
    await render(job(["done", "done", "done", "failed"], { state: "failed", phase: "failed", rolledBack: true, failureCode: "agent_game_health_failed",
        failureMessage: "The game did not start on the new version. We returned your server to 0.1.10. Your campaign and the backup taken before the change are intact.",
        nextStep: "Check that your campaign and enabled mods work on that version, then try again.", backup: { backupId: jobId } }));
    const alert = [...container.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes("did not finish"))!;
    expect(alert.textContent).toContain("We returned your server to 0.1.10");
    expect(alert.textContent).toContain("then try again");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect([...container.querySelectorAll("ol li")][3].textContent).toBe("Installing 0.1.11Failed");
    expect(container.textContent).not.toContain(jobId);
});

it("reports a cancelled update", async () => {
    await render(job(["done", "skipped"], { state: "cancelled", phase: "cancelled" }));
    expect(container.textContent).toContain("The update was cancelled.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
});
