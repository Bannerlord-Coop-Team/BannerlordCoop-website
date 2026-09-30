import { renderToReadableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), request: vi.fn(), accounts: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerViewer: mocks.auth }));
vi.mock("@/app/lib/supabase/users", () => ({ listWebsiteAccounts: mocks.accounts }));
vi.mock("@/app/lib/control-plane/server-read", () => ({ readControlPlaneAdmin: mocks.request }));
vi.mock("@/app/components/admin/RefreshReleaseCatalog", () => ({ RefreshReleaseCatalog: () => null }));
import ControlPlaneAdminPage from "./page";

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockImplementation(async options => {
        const read = options.onReadOnlySession("test-admin-token");
        return { read, user: { id: "admin", app_metadata: { role: "Admin" } }, accessToken: "test-admin-token" };
    });
    mocks.request.mockResolvedValue({
        fleet: { running: 5, stopped: 0, suspended: 0, provisioning: 0, failedOrDegraded: 0,
            activeJobs: 0, agentUnhealthyOrUnknown: 0, pendingDeletion: 0, backupFailures: 0,
            managedVpsCount: 1, usedQuota: 5, totalSlots: 6, availableSlots: 1,
            observability: { recentJobFailures: 2 }, provider: { orphanCandidateCount: 0 }, lastReconciledAt: null },
        controls: { provisioningPaused: false, startsPaused: false, backupsPaused: false, maintenancePaused: false,
            nightlyRolloutsPaused: false, reason: "Current control reason" },
        jobs: { items: [], nextCursor: null },
    });
});

it("renders Overview from its compact current response without fetching account or server directories", async () => {
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "overview" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("Fleet capacity and reconciliation");
    expect(html).toContain("Current control reason");
    expect(html).toContain("Recent jobs");
    expect(html).not.toContain("The control plane view could not be loaded");
    expect(mocks.request.mock.calls).toEqual([[{ accessToken: "test-admin-token", operation: "overview", input: { compact: true }, signal: expect.any(AbortSignal) }]]);
    expect(mocks.accounts).not.toHaveBeenCalled();
});

it("renders both complete release groups from one catalog request without account lookups", async () => {
    const build = { buildId: "stable-v0.1.10", channel: "stable", version: "v0.1.10", sourceRevision: "registry-observed",
        supportedGameVersion: "v1.4.8", validationState: "validated", publishedAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z", currentChannel: true,
        registryMetadata: { versionTag: "v0.1.10", clientRevision: "a".repeat(40), serverRevision: "b".repeat(40) } };
    mocks.request.mockResolvedValue({
        stable: { items: [build], nextCursor: null },
        nightly: { items: [{ ...build, buildId: "nightly-v0.1.11", channel: "nightly", version: "v0.1.11",
            requiredClientModVersion: "v0.1.11", registryMetadata: { ...build.registryMetadata, versionTag: "v0.1.11-nightly" } }], nextCursor: null },
    });
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "releases" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("v0.1.10"); expect(html).toContain("v0.1.11");
    expect(html.replaceAll("<!-- -->", "")).toContain("Current Public");
    expect(html.replaceAll("<!-- -->", "")).toContain("Current Nightly");
    expect(html).not.toContain("The control plane view could not be loaded");
    expect(mocks.request.mock.calls).toEqual([[{ accessToken: "test-admin-token", operation: "release-catalog",
        input: { stableCursor: null, nightlyCursor: null, limit: 100 }, signal: expect.any(AbortSignal) }]]);
    expect(mocks.accounts).not.toHaveBeenCalled();
});


it("starts the read before viewer verification completes but withholds the entire page and account directory", async () => {
    const gate = Promise.withResolvers<void>();
    mocks.auth.mockImplementation(async options => {
        const read = options.onReadOnlySession("test-admin-token");
        await gate.promise;
        return { read, user: { id: "admin", app_metadata: { role: "Admin" } }, accessToken: "test-admin-token" };
    });
    let rendered = false;
    const page = ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "servers" }) });
    void page.then(() => { rendered = true; });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(rendered).toBe(false);
    expect(mocks.accounts).not.toHaveBeenCalled();
    gate.resolve();
    await page;
    // Account lookup is in the authenticated streaming content, never the speculative read.
    expect(mocks.accounts).not.toHaveBeenCalled();
});

it.each(["revoked", "member", "mismatched"])("aborts and does not render early data for a %s viewer", async kind => {
    mocks.auth.mockImplementation(async options => {
        const read = options.onReadOnlySession("test-admin-token");
        if (kind === "revoked") throw new Error("revoked");
        return { read, user: { id: "admin", app_metadata: { role: kind === "member" ? "Member" : "Admin" } }, accessToken: kind === "mismatched" ? null : "test-admin-token" };
    });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "servers" }) })).rejects.toThrow();
    expect(mocks.request.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mocks.accounts).not.toHaveBeenCalled();
});

it("consumes early read failures and preserves the ordinary error UI after authentication", async () => {
    mocks.request.mockRejectedValue(new Error("endpoint unavailable"));
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "overview" }) }));
    await stream.allReady;
    expect(await new Response(stream).text()).toContain("The control plane view could not be loaded.");
});


it.each(["overview", "servers", "server", "vps", "jobs", "releases", "audit", "operations"])("cancels every %s request on failed viewer validation and starts only read operations", async view => {
    mocks.auth.mockImplementation(async options => {
        options.onReadOnlySession("test-admin-token");
        throw new Error("session context unavailable");
    });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({ view, serverId: "test-server" }) })).rejects.toThrow("session context unavailable");
    expect(mocks.request.mock.calls.length).toBeGreaterThan(0);
    for (const [request] of mocks.request.mock.calls) {
        expect(["overview", "servers", "server-dashboard", "vps-hosts", "jobs", "release-catalog", "audit"]).toContain(request.operation);
        expect(request.signal.aborted).toBe(true);
        expect(request.accessToken).toBe("test-admin-token");
    }
    expect(mocks.accounts).not.toHaveBeenCalled();
});


it("releases the authenticated shell while the early read is still pending", async () => {
    const pendingRead = Promise.withResolvers<unknown>();
    mocks.request.mockReturnValue(pendingRead.promise);
    const page = await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "servers" }) });
    expect(page).toBeDefined();
    expect(mocks.accounts).not.toHaveBeenCalled();
    pendingRead.resolve({ items: [], nextCursor: null });
});
