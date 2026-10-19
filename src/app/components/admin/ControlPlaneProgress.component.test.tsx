import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { ControlPlaneJobsProgress } from "./ControlPlaneJobsProgress";
import { ControlPlaneServerView } from "./ControlPlaneServerView";
import type { JobTableRow } from "./ControlPlaneReadTables";
import type { ServerDashboardResult } from "@/app/lib/control-plane/types";
import { serverProgressView } from "@/app/lib/control-plane/server-progress";

const { request, session, refresh } = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async original => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
let root: Root;
let container: HTMLDivElement;
const job: JobTableRow = { jobId: "33333333-3333-4333-8333-333333333333", action: "start", state: "running",
    serverLabel: "Server A", progressStage: "start.game", errorCode: null, attemptCount: 1, maximumAttempts: 3,
    updatedAt: "2026-10-12T00:00:00.000Z" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function visible(value: boolean) {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: value ? "visible" : "hidden" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}
async function renderJobs(jobs = [job]) { await act(async () => root.render(<ControlPlaneJobsProgress jobs={jobs} allowFailureAcknowledgement={false} />)); }
beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    session.mockResolvedValue({ data: { session: { access_token: "fresh-token" } } });
    request.mockResolvedValue([job]);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it("backs unchanged progress off to 30 seconds, resets on change, and never refreshes a page", async () => {
    await renderJobs(); await advance(4_000); expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({ operation: "jobs-progress", input: { jobIds: [job.jobId] }, accessToken: "fresh-token" });
    await advance(7_999); expect(request).toHaveBeenCalledTimes(1);
    await advance(1); expect(request).toHaveBeenCalledTimes(2);
    await advance(16_000); expect(request).toHaveBeenCalledTimes(3);
    request.mockResolvedValue([{ ...job, progressStage: "start.verifying" }]);
    await advance(30_000); expect(request).toHaveBeenCalledTimes(4);
    expect(container.textContent).toContain("start.verifying");
    await advance(4_000); expect(request).toHaveBeenCalledTimes(5);
    expect(refresh).not.toHaveBeenCalled();
});
it("pauses hidden tabs and reauthenticates immediately on return", async () => {
    await visible(false); await renderJobs(); await advance(60_000);
    expect(request).not.toHaveBeenCalled(); expect(session).not.toHaveBeenCalled();
    await visible(true); expect(request).toHaveBeenCalledTimes(1);
    await visible(false); await advance(60_000); expect(request).toHaveBeenCalledTimes(1);
    await visible(true); expect(request).toHaveBeenCalledTimes(2); expect(session).toHaveBeenCalledTimes(2);
});
it("waits for a slow read before scheduling another, including across hide/show", async () => {
    const pending = deferred<JobTableRow[]>(); request.mockReturnValueOnce(pending.promise);
    await renderJobs(); await advance(4_000); await advance(12_000);
    expect(request).toHaveBeenCalledTimes(1);
    await visible(false); expect(request.mock.calls[0][0].signal.aborted).toBe(true);
    await visible(true); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve([{ ...job, progressStage: "late-hidden-reading" }]));
    expect(container.textContent).not.toContain("late-hidden-reading");
    await advance(0); expect(request).toHaveBeenCalledTimes(2);
});
it.each(["succeeded", "failed", "cancelled"])("renders a terminal %s job once then stops polling", async state => {
    request.mockResolvedValue([{ ...job, state }]); await renderJobs(); await advance(4_000);
    expect(container.textContent).toContain(state);
    await advance(120_000); expect(request).toHaveBeenCalledTimes(1);
    await visible(false); await visible(true); expect(request).toHaveBeenCalledTimes(1);
});
it("does not poll initially terminal jobs", async () => {
    await renderJobs([{ ...job, state: "succeeded" }]); await advance(120_000);
    expect(request).not.toHaveBeenCalled();
});
it("keeps terminal outcomes while following only the remaining active jobs", async () => {
    const other = { ...job, jobId: "44444444-4444-4444-8444-444444444444", serverLabel: "Server B" };
    request.mockResolvedValueOnce([{ ...job, state: "succeeded" }, other]);
    request.mockResolvedValueOnce([{ ...other, state: "failed" }]);
    await renderJobs([job, other]); await advance(4_000); await advance(4_000);
    expect(request.mock.calls[1][0].input).toEqual({ jobIds: [other.jobId] });
    expect(container.textContent).toContain("succeeded"); expect(container.textContent).toContain("failed");
    await advance(60_000); expect(request).toHaveBeenCalledTimes(2);
});
it("ends a slow browser read at the deadline and retries after backoff", async () => {
    request.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    await renderJobs(); await advance(4_000); await advance(29_999);
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][0].signal.aborted).toBe(false);
    await advance(1); expect(request.mock.calls[0][0].signal.aborted).toBe(true);
    expect(container.textContent).toContain("Showing the last reading; retrying.");
    await advance(8_000); expect(request).toHaveBeenCalledTimes(2);
});
it("clears rows when the local session ends without sending another request", async () => {
    session.mockResolvedValue({ data: { session: null } }); await renderJobs(); await advance(4_000);
    expect(container.textContent).not.toContain("Server A"); expect(container.textContent).toContain("Authentication is required.");
    await advance(60_000); expect(session).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
});
it.each(["forbidden", "unauthenticated"])("clears retained rows and stops after authority loss: %s", async code => {
    request.mockRejectedValue(new ControlPlaneAdminError(code, "Access is no longer available."));
    await renderJobs(); await advance(4_000);
    expect(container.textContent).not.toContain("Server A");
    expect(container.textContent).toContain("Access is no longer available.");
    await advance(60_000); await visible(false); await visible(true); expect(request).toHaveBeenCalledTimes(1);
});
it("retains but marks the last reading on a transient failure and recovers without overlapping", async () => {
    request.mockRejectedValueOnce(new ControlPlaneAdminError("unavailable", "Unavailable", true));
    await renderJobs(); await advance(4_000);
    expect(container.textContent).toContain("Showing the last reading; retrying.");
    expect(container.textContent).toContain("Server A");
    await advance(8_000); expect(request).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("retrying.");
});
it("discards a late response when the displayed page changes and aborts on unmount", async () => {
    const pending = deferred<JobTableRow[]>(); request.mockReturnValueOnce(pending.promise);
    await renderJobs(); await advance(4_000);
    const oldSignal = request.mock.calls[0][0].signal;
    await renderJobs([{ ...job, jobId: "other-job", serverLabel: "Server B" }]);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => pending.resolve([{ ...job, state: "failed" }]));
    expect(container.textContent).toContain("Server B"); expect(container.textContent).not.toContain("Server A");
    const next = deferred<JobTableRow[]>(); request.mockReturnValueOnce(next.promise);
    await advance(4_000); const nextSignal = request.mock.calls[1][0].signal;
    await act(async () => root.render(null)); expect(nextSignal.aborted).toBe(true);
});

const serverId = "22222222-2222-4222-8222-222222222222";
const dashboard = { dashboard: { server: { serverId, displayName: "Campaign A", ownerDiscordUserId: "192469416892432384",
    friendlyRegion: "germany", provider: "ovhcloud-vps", operationState: "starting", desiredState: "running", observedVmState: "running", observedGameState: "stopped",
    releaseChannel: "stable", updatedAt: job.updatedAt }, activeJob: { ...job, serverId }, runtime: null,
    installedBuild: null, desiredBuild: null, activeSave: null }, backups: { items: [], nextCursor: null }, audit: { items: [], nextCursor: null } } as unknown as ServerDashboardResult;
it("projects initial client props without internal server, job, build or history fields", () => {
    const source = { ...dashboard, dashboard: { ...dashboard.dashboard,
        server: { ...dashboard.dashboard.server, gamePasswordSecretRef: "private-server" },
        activeJob: { ...dashboard.dashboard.activeJob!, requestPayload: { secret: "private-job" }, leaseOwner: "private-worker" } },
        backups: { items: [], nextCursor: null, privateObject: "private-backup" } };
    const serialized = JSON.stringify(serverProgressView(source));
    expect(serialized).toContain("Campaign A"); expect(serialized).not.toContain("private-");
});
it("reads compact server progress then hydrates final details once without a page or directory refresh", async () => {
    request.mockResolvedValueOnce({ server: { ...dashboard.dashboard.server, softDeletedAt: null }, activeJob: { ...job, serverId, progressStage: "start.verifying" } });
    await act(async () => root.render(<ControlPlaneServerView initial={serverProgressView(dashboard)} accounts={[]} />));
    await advance(4_000); expect(container.textContent).toContain("start.verifying");
    request.mockResolvedValueOnce({ server: { ...dashboard.dashboard.server, softDeletedAt: null }, activeJob: null });
    request.mockResolvedValueOnce({ ...dashboard, dashboard: { ...dashboard.dashboard, activeJob: null, server: { ...dashboard.dashboard.server, operationState: "running" }, activeSave: { displayName: "Final campaign" } } });
    await advance(4_000);
    expect(request.mock.calls.map(([input]) => input.operation)).toEqual(["server-progress", "server-progress", "server-dashboard"]);
    expect(container.textContent).toContain("Final campaign");
    expect(container.textContent).not.toContain("Operation in progress");
    await advance(120_000); expect(request).toHaveBeenCalledTimes(3); expect(refresh).not.toHaveBeenCalled();
});
it("handles server deletion without repeatedly requesting an unavailable dashboard", async () => {
    request.mockResolvedValue({ server: { ...dashboard.dashboard.server, operationState: "deleted", softDeletedAt: job.updatedAt }, activeJob: null });
    await act(async () => root.render(<ControlPlaneServerView initial={serverProgressView(dashboard)} accounts={[]} />));
    await advance(4_000); expect(container.textContent).toContain("This server has been deleted.");
    await advance(60_000); expect(request).toHaveBeenCalledTimes(1);
});
it("retries a transient final-detail failure but clears the server when final authorization fails", async () => {
    const completed = { server: { ...dashboard.dashboard.server, softDeletedAt: null }, activeJob: null };
    request.mockResolvedValueOnce(completed).mockRejectedValueOnce(new ControlPlaneAdminError("unavailable", "Unavailable", true));
    await act(async () => root.render(<ControlPlaneServerView initial={serverProgressView(dashboard)} accounts={[]} />));
    await advance(4_000); expect(container.textContent).toContain("Showing the last reading; retrying.");
    request.mockResolvedValueOnce(completed).mockRejectedValueOnce(new ControlPlaneAdminError("forbidden", "Administrator access is required."));
    await advance(8_000); expect(container.textContent).not.toContain("Campaign A");
    expect(container.textContent).toContain("Administrator access is required.");
    await advance(60_000); expect(request).toHaveBeenCalledTimes(4);
});
