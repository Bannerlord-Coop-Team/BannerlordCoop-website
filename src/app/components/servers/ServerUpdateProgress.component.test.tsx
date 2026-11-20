import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { BuildStepState, BuildUpdateJob } from "../../../../supabase/functions/_shared/server-build-contract";
import { ServerUpdateProgress, ServerUpdateProgressStatus } from "./ServerUpdateProgress";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";
import { finishedUpdateJob, updateJob, updateSteps } from "./ServerUpdateProgress.test-utils";

const jobId = updateJob().jobId;
/** Builds an automatic update job with the given step states in display order, counting the done ones as completed. */
function job(states: BuildStepState[], extra: Partial<BuildUpdateJob> = {}): BuildUpdateJob {
    return updateJob({ initiatedBy: "automatic", steps: updateSteps(states), completedSteps: states.filter(state => state === "done").length, ...extra });
}

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

it.each([
    ["automatic", "0.1.11", "Automatic update to 0.1.11"],
    ["automatic", null, "Automatic update"],
    ["administrator", "0.1.11", "Hosting support is installing 0.1.11 on your server"],
    ["administrator", null, "Hosting support is installing a build on your server"],
    ["owner", "0.1.11", "Updating to 0.1.11"],
    ["owner", null, "Update progress"],
] as const)("heads an update started by %s with version %s as %s", async (initiatedBy, targetVersion, expectedHeading) => {
    await render(job(["done", "active"], { initiatedBy, targetVersion }));
    expect(container.querySelector("h3")?.textContent).toBe(expectedHeading);
});

it("names the install step without a version when the control plane reports none", async () => {
    await render(job(["done", "done", "done", "active"], { initiatedBy: "owner", targetVersion: null, previousVersion: null }));
    expect([...container.querySelectorAll("ol li")][3].textContent).toBe("Installing the updateIn progress");
});

it("reports a completed update as complete", async () => {
    await render(finishedUpdateJob({ initiatedBy: "automatic", progress: "Now running 0.1.11." }));
    expect(container.textContent).toContain("Now running 0.1.11.");
    expect(container.querySelector('[role="progressbar"]')!.getAttribute("aria-valuetext")).toBe("Complete");
});

it("reports a failed update with its reason, the automatic return and the next step, without exposing job identifiers", async () => {
    await render(job(["done", "done", "done", "failed"], { state: "failed", phase: "failed", rolledBack: true, failureCode: "agent_game_health_failed",
        failureMessage: "The game did not start on the new version. We returned your server to 0.1.10. Your campaign and the backup taken before the change are intact.",
        nextStep: "Create a General Help support ticket in our Discord (https://discord.gg/5vJzfz5Zzy) before changing versions again.", backup: { backupId: jobId } }));
    const alert = [...container.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes("did not finish"))!;
    expect(alert.textContent).toContain("We returned your server to 0.1.10");
    expect(alert.textContent).toContain("Create a General Help support ticket in our Discord before changing versions again.");
    const link = alert.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://discord.gg/5vJzfz5Zzy");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect([...container.querySelectorAll("ol li")][3].textContent).toBe("Installing 0.1.11Failed");
    expect(container.textContent).not.toContain(jobId);
});

it("reports a cancelled update", async () => {
    await render(job(["done", "skipped"], { state: "cancelled", phase: "cancelled" }));
    expect(container.textContent).toContain("The update was cancelled.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
});

it.each([
    ["unavailable", "Progress is unavailable. The update may still be running."],
    ["paused", "Progress checks paused. Refresh the page to check again."],
] as const)("explains why %s update progress cannot be shown as a polite status", async (error, expected) => {
    await act(async () => root.render(<TestLocalization><ServerUpdateProgressStatus job={null} error={error} /></TestLocalization>));
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toBe(expected);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
});
