import { renderToReadableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), auth: vi.fn(), request: vi.fn(), accounts: vi.fn(), account: vi.fn(), tables: vi.fn(), observations: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerReadSession: mocks.session, getSupabaseServerViewer: mocks.auth }));
vi.mock("@/app/lib/supabase/users", () => ({ listWebsiteAccounts: mocks.accounts, getWebsiteAccount: mocks.account }));
vi.mock("@/app/lib/control-plane/server-read", () => ({ readControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/control-plane/release-observations", () => ({ recordReleaseFirstObservations: mocks.observations }));
vi.mock("@/app/components/admin/RefreshReleaseCatalog", () => ({ RefreshReleaseCatalog: () => null }));
vi.mock("next/navigation", async importOriginal => ({
    ...await importOriginal<typeof import("next/navigation")>(), useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/components/admin/ControlPlaneReadTables", async importOriginal => {
    const actual = await importOriginal<typeof import("@/app/components/admin/ControlPlaneReadTables")>();
    return {
        JobsReadTable: (props: Parameters<typeof actual.JobsReadTable>[0]) => {
            mocks.tables("jobs", props);
            return <actual.JobsReadTable {...props} />;
        },
        AuditReadTable: (props: Parameters<typeof actual.AuditReadTable>[0]) => {
            mocks.tables("audit", props);
            return <actual.AuditReadTable {...props} />;
        },
    };
});
import ControlPlaneAdminPage from "./page";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { hostingRegionCatalogPayload } from "../../../../supabase/functions/_shared/hosting-regions";

beforeEach(() => {
    vi.resetAllMocks();
    mocks.observations.mockImplementation(async builds => builds.map((build: object) => ({ ...build, firstObservedAt: "2026-09-28T12:00:00.000Z" })));
    mocks.session.mockResolvedValue({ impersonating: false, session: { access_token: "test-admin-token", user: { id: "admin", app_metadata: { role: "Member" } } } });
    mocks.auth.mockResolvedValue({ user: { id: "admin", app_metadata: { role: "Admin" } }, accessToken: "test-admin-token" });
    mocks.request.mockImplementation(async request => {
        request.onAuthenticated();
        return {
        fleet: { running: 5, stopped: 0, suspended: 0, provisioning: 0, failedOrDegraded: 0,
            activeJobs: 0, agentUnhealthyOrUnknown: 0, pendingDeletion: 0, backupFailures: 0,
            managedVpsCount: 1, usedQuota: 5, totalSlots: 6, availableSlots: 1,
            observability: { recentJobFailures: 2 }, provider: {}, lastReconciledAt: null },
        controls: { provisioningPaused: false, startsPaused: false, backupsPaused: false, maintenancePaused: false,
            nightlyRolloutsPaused: false, reason: "Current control reason" },
        jobs: { items: [], nextCursor: null },
    }; });
});

it("renders Overview from its compact current response without fetching account or server directories", async () => {
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "overview" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("Fleet capacity and reconciliation");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(html).toContain("Current control reason");
    expect(html).toContain("Recent jobs");
    expect(html).not.toContain("The control plane view could not be loaded");
    expect(mocks.request.mock.calls).toEqual([[{ accessToken: "test-admin-token", operation: "overview", input: { compact: true }, signal: expect.any(AbortSignal), expectedUserId: "admin", requireOrdinarySession: true, onAuthenticated: expect.any(Function) }]]);
    expect(mocks.accounts).not.toHaveBeenCalled();
});

it.each([true, false])("server detail resolves only its displayed account, with an ID fallback: available=%s", async available => {
    const ownerAccountId = "11111111-1111-4111-8111-111111111111";
    mocks.request.mockImplementation(async request => {
        request.onAuthenticated();
        return { dashboard: { server: { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Test campaign",
            ownerAccountId, ownerDiscordUserId: ownerAccountId, operationState: "stopped", friendlyRegion: "germany",
            desiredState: "stopped", observedVmState: "running", observedGameState: "stopped", provider: "ovhcloud-vps", releaseChannel: "stable" },
        activeJob: null, activeSave: null, installedBuild: null, desiredBuild: null, runtime: null },
        backups: { items: [] }, audit: { items: [] } };
    });
    if (available) mocks.account.mockResolvedValue({ accountId: ownerAccountId, label: "owner@example.test" });
    else mocks.account.mockRejectedValue(new Error("Auth account unavailable"));
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "server", serverId: "22222222-2222-4222-8222-222222222222" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain(available ? "owner@example.test" : ownerAccountId);
    expect(mocks.account).toHaveBeenCalledExactlyOnceWith(ownerAccountId);
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
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
    expect(html).toContain("First observed");
    expect(html).toContain('dateTime="2026-09-28T12:00:00.000Z"');
    expect(html).not.toContain('dateTime="2026-09-30T00:00:00.000Z"');
    expect(mocks.observations).toHaveBeenCalledTimes(1);
    expect(html).not.toContain("The control plane view could not be loaded");
    expect(mocks.request.mock.calls).toEqual([[{ accessToken: "test-admin-token", operation: "release-catalog",
        input: { stableCursor: null, nightlyCursor: null, limit: 100 }, signal: expect.any(AbortSignal), expectedUserId: "admin", requireOrdinarySession: true, onAuthenticated: expect.any(Function) }]]);
    expect(mocks.accounts).not.toHaveBeenCalled();
});

it("renders Operations with fresh VPS choices and capacity without requesting unused billing", async () => {
    mocks.accounts.mockResolvedValue({ users: [], truncated: false });
    mocks.request.mockImplementation(async request => {
        if (request.operation === "overview") return { controls: {}, servers: { items: [] }, jobs: { items: [] } };
        if (request.operation === "release-catalog") return { stable: { items: [] }, nightly: { items: [] } };
        if (request.operation === "vps-hosts") return {
            availableHosts: [{ provider: "ovhcloud-vps", serviceName: "vps-available.vps.ovh.us", label: "OVHcloud VPS · vps-available.vps.ovh.us" }],
            hosts: [{ locationId: "os-us-east-va-2", countryCode: "US", region: null, availableServers: 1, totalSlots: 2 }] };
        // Only US-East has a free slot in the stored catalog, so it is the only Create region offered.
        if (request.operation === "hosting-regions") return { revision: 4, updatedAt: "2026-10-09T12:00:00.000Z", updatedBy: "supabase:admin",
            regions: hostingRegionCatalogPayload()
                .filter((entry) => entry.region === "us-west" || entry.region === "us-east")
                .map((entry) => ({ ...entry, available: entry.region === "us-east" })) };
        throw new Error("Unexpected read");
    });
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "operations" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).not.toContain("Hosting regions");
    expect(html).not.toContain("Publish website regions");
    expect(html).toContain("Onboard provider-account VPS");
    expect(html).toContain("OVHcloud VPS · vps-available.vps.ovh.us");
    // The option value carries the listed provider so onboarding never guesses it.
    expect(html).toContain("{&quot;provider&quot;:&quot;ovhcloud-vps&quot;,&quot;serviceName&quot;:&quot;vps-available.vps.ovh.us&quot;}");
    const createCard = cardHtml(html, "create-server");
    expect(createCard.match(/<option value="us-east">US-East<\/option>/gu) ?? []).toHaveLength(1);
    expect(createCard).not.toContain('value="us-west"');
    // This older inventory has no manualEntryProviders, so the manual card explains why it is unavailable.
    const manualCard = cardHtml(html, "onboard-manual-vps-host");
    expect(manualCard).toContain("Add manual VPS");
    expect(manualCard).toContain("No provider currently accepts manual entry.");
    expect(html).not.toContain("The control plane view could not be loaded");
    expect(mocks.request.mock.calls.filter(([request]) => request.operation === "vps-hosts")).toEqual([[{
        accessToken: "test-admin-token", operation: "vps-hosts", signal: expect.any(AbortSignal), expectedUserId: "admin", requireOrdinarySession: true, onAuthenticated: expect.any(Function),
        input: { includeLiveData: false, includeProviderInventory: "service-names" },
    }]]);
    expect(mocks.request.mock.calls.filter(([request]) => request.operation === "hosting-regions")).toEqual([[expect.objectContaining({ operation: "hosting-regions", input: {} })]]);
    expect(mocks.request).toHaveBeenCalledTimes(4);
});

it("keeps Operations usable when the stored hosting-region catalog cannot be read", async () => {
    mocks.accounts.mockResolvedValue({ users: [], truncated: false });
    mocks.request.mockImplementation(async request => {
        if (request.operation === "overview") return { controls: {}, servers: { items: [] }, jobs: { items: [] } };
        if (request.operation === "release-catalog") return { stable: { items: [] }, nightly: { items: [] } };
        if (request.operation === "vps-hosts") return { availableHosts: [], hosts: [] };
        throw new ControlPlaneAdminError("unsupported_operation", "The operation is not supported.");
    });
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "operations" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("The operation is not supported.");
    expect(html).not.toContain("Publish website regions");
    expect(html).toContain("Onboard provider-account VPS");
    expect(html).toContain("Regions are unavailable: The operation is not supported.");
});


it("offers every stored region and the listed manual-entry providers on Add manual VPS", async () => {
    mocks.accounts.mockResolvedValue({ users: [], truncated: false });
    mocks.request.mockImplementation(async request => {
        if (request.operation === "overview") return { controls: {}, servers: { items: [] }, jobs: { items: [] } };
        if (request.operation === "release-catalog") return { stable: { items: [] }, nightly: { items: [] } };
        if (request.operation === "vps-hosts") return { availableHosts: [], hosts: [],
            manualEntryProviders: [{ provider: "hosthatch-vps", displayName: "HostHatch VPS" }] };
        if (request.operation === "hosting-regions") return { regions: hostingRegionCatalogPayload()
            .filter((entry) => entry.region === "us-west" || entry.region === "us-east")
            .map((entry) => ({ ...entry, available: false })) };
        throw new Error("Unexpected read");
    });
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "operations" }) }));
    await stream.allReady;
    const manualCard = cardHtml(await new Response(stream).text(), "onboard-manual-vps-host");
    expect(manualCard).toContain('<option value="hosthatch-vps" selected="">HostHatch VPS</option>');
    // Onboarding adds capacity, so regions without a free slot are offered too.
    expect(manualCard).toContain('value="us-east"');
    expect(manualCard).toContain('value="us-west"');
    expect(manualCard).not.toContain("No provider currently accepts manual entry.");
    expect(manualCard).toContain('name="sshLogin"');
    // The control plane scans and pins the host key on first contact, so the form never asks for one.
    expect(manualCard).not.toContain("hostPublicKey");
});

/** The server-rendered markup of one operation card, located by its anchor id. */
function cardHtml(html: string, operation: string) {
    const start = html.indexOf(`id="${operation}"`);
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</article>", start));
}

it("registers Capacity after Placement and leaves the rate-limited capacity read to the browser", async () => {
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "capacity" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    const tabs = [...html.matchAll(/<a [^>]*href="\/admin\/control-plane\?view=([a-z]+)"[^>]*>/gu)];
    expect(tabs.map(([, view]) => view)).toEqual(["overview", "vps", "servers", "jobs", "releases", "audit", "operations", "relocate", "placement", "capacity", "notices"]);
    expect(tabs.find(([, view]) => view === "capacity")![0]).toContain('aria-current="page"');
    expect(html).toMatch(/view=capacity"[^>]*>(?:<svg[^]*?<\/svg>)?\s*(?:<!-- -->)?\s*Capacity<\/a>/u);
    expect(html).toContain("Fleet capacity");
    expect(html).toContain("Loading fleet capacity…");
    expect(html).not.toContain("The control plane view could not be loaded");
    // The control plane authorizes the page through a small read, as for every other view.
    expect(mocks.request.mock.calls.map(([request]) => [request.operation, request.input])).toEqual([["hosting-regions", {}]]);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.accounts).not.toHaveBeenCalled();
});

it("withholds the page and account directory until Oracle confirms fresh identity and authority", async () => {
    const gate = Promise.withResolvers<void>();
    mocks.request.mockImplementation(async request => {
        await gate.promise;
        request.onAuthenticated();
        return { items: [], nextCursor: null };
    });
    let rendered = false;
    const page = ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "servers" }) });
    void page.then(() => { rendered = true; });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(rendered).toBe(false);
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
    gate.resolve();
    await page;
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
});

it.each(["revoked", "member", "mismatched"])("aborts and does not render early data for a %s viewer", async kind => {
    mocks.request.mockRejectedValue(new Error("Oracle did not confirm authority"));
    mocks.auth.mockImplementation(async () => {
        if (kind === "revoked") throw new Error("revoked");
        return { user: { id: "admin", app_metadata: { role: kind === "member" ? "Member" : "Admin" } }, accessToken: kind === "mismatched" ? null : "test-admin-token" };
    });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "servers" }) })).rejects.toThrow();
    expect(mocks.request.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mocks.accounts).not.toHaveBeenCalled();
});

it("never renders the VPS view, where the slot decommission controls live, for a member", async () => {
    mocks.request.mockRejectedValue(new Error("Oracle did not confirm authority"));
    mocks.auth.mockResolvedValue({ user: { id: "admin", app_metadata: { role: "Member" } }, accessToken: "test-admin-token" });
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "vps" }) })).rejects.toThrow();
    // Only the view's reads start, and each is cancelled; no slot decommission request is ever sent.
    expect(mocks.request.mock.calls.map(([request]) => request.operation).sort()).toEqual(["hosting-regions", "vps-hosts"]);
    for (const [request] of mocks.request.mock.calls) expect(request.signal.aborted).toBe(true);
});

it("consumes early read failures and preserves the ordinary error UI after authentication", async () => {
    mocks.request.mockRejectedValue(new Error("endpoint unavailable"));
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "overview" }) }));
    await stream.allReady;
    expect(await new Response(stream).text()).toContain("The control plane view could not be loaded.");
});


it.each(["overview", "servers", "server", "vps", "jobs", "releases", "audit", "operations", "capacity"])("cancels every %s request on failed viewer validation and starts only read operations", async view => {
    mocks.request.mockRejectedValue(new Error("Oracle did not confirm authority"));
    mocks.auth.mockRejectedValue(new Error("session context unavailable"));
    await expect(ControlPlaneAdminPage({ searchParams: Promise.resolve({ view, serverId: "test-server" }) })).rejects.toThrow("session context unavailable");
    expect(mocks.observations).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls.length).toBeGreaterThan(0);
    for (const [request] of mocks.request.mock.calls) {
        expect(["overview", "servers", "server-dashboard", "vps-hosts", "jobs", "release-catalog", "audit", "hosting-regions"]).toContain(request.operation);
        expect(request.signal.aborted).toBe(true);
        expect(request.accessToken).toBe("test-admin-token");
    }
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.tables).not.toHaveBeenCalled();
});


it("releases the authenticated shell while the early read is still pending", async () => {
    const pendingRead = Promise.withResolvers<unknown>();
    mocks.request.mockImplementation(request => { request.onAuthenticated(); return pendingRead.promise; });
    const page = await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "servers" }) });
    expect(page).toBeDefined();
    expect(mocks.accounts).not.toHaveBeenCalled();
    pendingRead.resolve({ items: [], nextCursor: null });
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.auth).not.toHaveBeenCalled();
});


it("projects only displayed job fields and preserves the fresh failed-attempt controls", async () => {
    const updatedAt = "2026-09-30T00:00:00.000Z";
    const job = { jobId: "job-fixture", action: "backup", state: "failed", serverId: "44444444-4444-4444-8444-444444444444",
        progressStage: "failed", errorCode: "backup_failed", attemptCount: 2, maximumAttempts: 3, updatedAt,
        failureAcknowledgedAt: null, failureAcknowledgedBy: "undisplayed-actor", authority: "undisplayed-authority",
        createdAt: "undisplayed-created", runAt: "undisplayed-run", unknownFutureField: "never-cross-the-boundary" };
    for (const acknowledged of [false, true]) {
        mocks.request.mockResolvedValue({ items: [{ ...job, failureAcknowledgedAt: acknowledged ? updatedAt : null }], nextCursor: "next-page" });
        const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "jobs", state: "failed" }) }));
        await stream.allReady;
        const html = await new Response(stream).text();
        expect(html).toContain("backup_failed"); expect(html).toContain("Older jobs");
        expect(html).toContain(acknowledged ? "Silenced" : "Acknowledge this exact failed attempt");
        const props = mocks.tables.mock.calls.at(-1)?.[1];
        expect(props.allowFailureAcknowledgement).toBe(true);
        expect(props.jobs).toEqual([{ jobId: job.jobId, action: job.action, state: job.state, serverLabel: "44444444…444444",
            progressStage: job.progressStage, errorCode: job.errorCode, attemptCount: 2, maximumAttempts: 3,
            updatedAt, failureAcknowledgedAt: acknowledged ? updatedAt : null }]);
        expect(JSON.stringify(props)).not.toContain("undisplayed");
        expect(JSON.stringify(props)).not.toContain("never-cross-the-boundary");
    }
    expect(mocks.request).toHaveBeenCalledTimes(2); expect(mocks.accounts).not.toHaveBeenCalled();
});

it("projects only displayed audit fields while retaining reasons and shortened identifiers", async () => {
    mocks.request.mockResolvedValue({ items: [{ eventId: "event-fixture", actorType: "administrator", actorId: "44444444-4444-4444-8444-444444444444",
        targetDiscordUserId: "undisplayed-target", targetServerId: null, action: "hosting.job.succeeded", reason: "Fresh audit reason",
        correlationId: "55555555-5555-5555-8555-555555555555", occurredAt: "2026-09-30T00:00:00.000Z", unknownFutureField: "never-cross-the-boundary" }], nextCursor: null });
    const stream = await renderToReadableStream(await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "audit" }) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain("Fresh audit reason"); expect(html).toContain("44444444…444444");
    expect(mocks.tables).toHaveBeenCalledExactlyOnceWith("audit", { events: [{ eventId: "event-fixture", actorType: "administrator", actorLabel: "44444444…444444",
        serverLabel: "—", action: "hosting.job.succeeded", reason: "Fresh audit reason", correlationLabel: "55555555…555555", occurredAt: "2026-09-30T00:00:00.000Z" }] });
    expect(mocks.accounts).not.toHaveBeenCalled();
});


it("does not start reads before session refresh and impersonation validation, or after validation fails", async () => {
    const session = Promise.withResolvers<unknown>();
    mocks.session.mockReturnValue(session.promise);
    const page = ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "overview" }) });
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.request).not.toHaveBeenCalled();
    session.reject(new Error("impersonation expired"));
    await expect(page).rejects.toThrow("impersonation expired");
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.accounts).not.toHaveBeenCalled();
});

it("does not let a late concurrent read override failed fresh fallback authentication", async () => {
    const fallback = Promise.withResolvers<unknown>();
    mocks.auth.mockReturnValue(fallback.promise);
    const pending = Promise.withResolvers<unknown>();
    mocks.request.mockImplementation(request => request.operation === "overview" ? Promise.reject(new Error("unavailable")) : pending.promise);
    const page = ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "operations" }) });
    await vi.waitFor(() => expect(mocks.auth).toHaveBeenCalledOnce());
    for (const [request] of mocks.request.mock.calls) request.onAuthenticated();
    fallback.resolve({ user: null, accessToken: null });
    await expect(page).rejects.toThrow();
    expect(mocks.accounts).not.toHaveBeenCalled(); expect(mocks.tables).not.toHaveBeenCalled();
    pending.resolve({});
});


it("requests the ordinary-session guard unless impersonation was fully validated before the read", async () => {
    await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "overview" }) });
    expect(mocks.request.mock.calls.at(-1)?.[0].requireOrdinarySession).toBe(true);
    mocks.session.mockResolvedValue({ impersonating: true, session: { access_token: "test-admin-token", user: { id: "admin" } } });
    await ControlPlaneAdminPage({ searchParams: Promise.resolve({ view: "overview" }) });
    expect(mocks.request.mock.calls.at(-1)?.[0].requireOrdinarySession).toBe(false);
    expect(mocks.auth).not.toHaveBeenCalled();
});
