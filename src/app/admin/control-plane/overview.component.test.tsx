import { renderToReadableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), request: vi.fn(), accounts: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/supabase/users", () => ({ listWebsiteAccounts: mocks.accounts }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<object>(), requestControlPlaneAdmin: mocks.request }));
import ControlPlaneAdminPage from "./page";

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: {
        getUser: async () => ({ data: { user: { id: "admin", app_metadata: { role: "Admin" } } } }),
        getSession: async () => ({ data: { session: { access_token: "test-admin-token" } } }),
    } });
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
    expect(mocks.request.mock.calls).toEqual([[{ accessToken: "test-admin-token", operation: "overview", input: { compact: true } }]]);
    expect(mocks.accounts).not.toHaveBeenCalled();
});
