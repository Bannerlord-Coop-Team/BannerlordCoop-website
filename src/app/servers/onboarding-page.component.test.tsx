import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { onboardingSummary, ONBOARDING_TEST_ID } from "../../../tests/onboarding-fixtures";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), onboarding: vi.fn(), publicList: vi.fn(), account: vi.fn() }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: mocks.account }));
vi.mock("@/app/lib/hosting/public-servers", () => ({ listPublicServers: mocks.publicList }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", () => ({ listAllMyServers: mocks.list, getServerOnboarding: mocks.onboarding }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => <nav>Navigation</nav> }));
vi.mock("@/app/components/servers/ServerOnboarding", () => ({ ServerOnboarding: ({ userId, summary }: { userId: string; summary: unknown }) => <div data-user={userId}>{summary ? "Trusted onboarding snapshot" : "Unavailable snapshot"}</div>, GamePasswordNotice: () => <p>Discord password controls</p> }));
vi.mock("@/app/components/servers/AllServersDirectory", () => ({ AllServersDirectory: () => <div>Public directory</div> }));
import ServersPage from "./page";
/** Collects the completed streamed page for existing content regressions. */
async function renderPage() {
    const stream = await renderToReadableStream(await ServersPage());
    await stream.allReady;
    return new Response(stream).text();
}
beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockResolvedValue(null);
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444", identities: [{ provider: "discord", identity_data: { sub: "123456789012345678" } }] } } }), getSession: async () => ({ data: { session: { access_token: "test-page-jwt", user: { id: "44444444-4444-4444-8444-444444444444" } } } }) } });
    mocks.list.mockResolvedValue([{ serverId: ONBOARDING_TEST_ID, displayName: "Assigned campaign", operationState: "stopped", observedGameState: "stopped", accessRole: "owner" }]);
    mocks.onboarding.mockResolvedValue(onboardingSummary());
    mocks.publicList.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

// Removed catalog settings must not resurrect an external server alongside authenticated inventory.
it("real servers page uses only managed inventory and ignores retired external configuration", async () => {
    vi.stubEnv("CONSOLE_SERVER_CATALOG", JSON.stringify([{ id: "legacy-server", name: "Legacy external campaign", address: "203.0.113.10", nodeId: "legacy-node", provider: "External VPS" }]));
    vi.stubEnv("CONSOLE_GATEWAY_URL", "wss://legacy.example.test/v1/browser");
    const html = await renderPage();
    expect(html).not.toContain("Legacy external campaign");
    expect(html).not.toContain("/servers/legacy-server");
    expect(html).toContain("Trusted onboarding snapshot"); expect(html).toContain('data-user="44444444-4444-4444-8444-444444444444"');
    expect(html).toContain("Assigned campaign"); expect(html).toContain("Public directory");
    expect(html).toContain(`/servers/${ONBOARDING_TEST_ID}`); expect(html).toContain("Offline");
    expect(mocks.onboarding).toHaveBeenCalledWith("test-page-jwt"); expect(mocks.list).toHaveBeenCalledWith("test-page-jwt");
});
it("public directory failure does not hide private inventory or fall back to placeholder listings", async () => {
    mocks.publicList.mockRejectedValue(new Error("public endpoint unavailable"));
    const html = await renderPage();
    expect(html).toContain("Directory unavailable");
    expect(html).not.toContain("Public directory</div>");
    expect(html).toContain("Assigned campaign");
    expect(html).toContain("Trusted onboarding snapshot");
});
it("summary failure remains unavailable rather than false eligibility or false full regions", async () => {
    mocks.onboarding.mockRejectedValue(new Error("edge not deployed"));
    const html = await renderPage(); expect(html).toContain("Unavailable snapshot"); expect(html).toContain("Assigned campaign");
});
it.each(["starting", "provisioning", "unknown", "stopped", "running"])("inventory, not creation receipt, supplies current %s state", async (state) => {
    mocks.list.mockResolvedValue([{ serverId: ONBOARDING_TEST_ID, displayName: "Assigned campaign", operationState: state, observedGameState: state === "running" ? "running" : state === "stopped" ? "stopped" : "unknown", accessRole: "owner" }]);
    const html = await renderPage();
    expect(html).toContain(state === "running" ? "Online" : state === "stopped" ? "Offline" : "Unknown");
});
it("signed-out page never requests private onboarding or inventory", async () => {
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) } });
    const html = await renderPage(); expect(html).toContain("Sign in to view"); expect(mocks.onboarding).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});

it("website-only accounts fetch allocations and keep existing inventory accessible", async () => {
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444", identities: [] } } }), getSession: async () => ({ data: { session: { access_token: "test-page-jwt", user: { id: "44444444-4444-4444-8444-444444444444" } } } }) } });
    const html = await renderPage();
    expect(mocks.onboarding).toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalled(); expect(html).toContain("Assigned campaign");
    expect(html).toContain("Owned servers"); expect(html).toContain("Associated servers");
});

it.each(["managed", "public"])("streams %s inventory without waiting for the other section", async (first) => {
    const managed = Promise.withResolvers<unknown[]>();
    const publicServers = Promise.withResolvers<unknown[]>();
    mocks.list.mockReturnValue(managed.promise);
    mocks.publicList.mockReturnValue(publicServers.promise);
    const stream = await renderToReadableStream(await ServersPage());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
        let shell = "";
        while (!shell.includes("</main>")) {
            const next = await reader.read();
            if (next.done) break;
            shell += decoder.decode(next.value, { stream: true });
        }
        expect(shell).toContain("My Servers");
        expect(shell).toContain("Public Servers");
        expect(shell).toContain("Loading your servers…");
        expect(shell).toContain("Loading public servers…");
        expect(shell).not.toContain("Assigned campaign");
        expect(shell).not.toContain("Public directory</div>");
        if (first === "managed") managed.resolve([{ serverId: ONBOARDING_TEST_ID, displayName: "Assigned campaign", operationState: "stopped", observedGameState: "stopped", accessRole: "owner" }]);
        else publicServers.resolve([]);
        let chunk = "";
        const expected = first === "managed" ? "Assigned campaign" : "Public directory</div>";
        while (!chunk.includes(expected)) {
            const next = await reader.read();
            if (next.done) break;
            chunk += decoder.decode(next.value, { stream: true });
        }
        expect(chunk).toContain(expected);
        expect(chunk).not.toContain(first === "managed" ? "Public directory</div>" : "Assigned campaign");
        expect(mocks.list).toHaveBeenCalledTimes(1);
        expect(mocks.publicList).toHaveBeenCalledTimes(1);
    } finally {
        managed.resolve([]);
        publicServers.resolve([]);
        await stream.allReady;
        reader.releaseLock();
    }
});


it.each(["auth", "account", "onboarding"] as const)("streams the public directory while %s is pending", async (dependency) => {
    const pending = Promise.withResolvers<unknown>();
    // Hold a real dependency indefinitely: the public section must arrive without it.
    mocks[dependency].mockReturnValueOnce(pending.promise);
    const stream = await renderToReadableStream(await ServersPage());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let html = "";
    // Collects streamed content until the requested independent section is present.
    async function readUntil(text: string) {
        while (!html.includes(text)) {
            const next = await reader.read();
            if (next.done) break;
            html += decoder.decode(next.value, { stream: true });
        }
        expect(html).toContain(text);
    }
    try {
        await readUntil("Public directory</div>");
        expect(html).toContain("My Servers");
        if (dependency === "auth") {
            expect(mocks.list).not.toHaveBeenCalled();
            expect(mocks.account).not.toHaveBeenCalled();
            expect(mocks.onboarding).not.toHaveBeenCalled();
        } else {
            await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledExactlyOnceWith("test-page-jwt"));
            await readUntil("Assigned campaign");
            expect(html).not.toContain("Trusted onboarding snapshot");
            if (dependency === "account") expect(mocks.onboarding).not.toHaveBeenCalled();
        }
        expect(mocks.publicList).toHaveBeenCalledTimes(1);
    } finally {
        // Exercise the existing failure fallbacks after proving independence.
        pending.reject(new Error("Dependency unavailable"));
        await stream.allReady;
        reader.releaseLock();
    }
});

it("never forwards a session token belonging to another user", async () => {
    mocks.auth.mockResolvedValue({ auth: {
        getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444" } } }),
        getSession: async () => ({ data: { session: { access_token: "other-user-token", user: { id: ONBOARDING_TEST_ID } } } }),
    } });
    const html = await renderPage();
    expect(html).toContain("Your authenticated server session is unavailable");
    expect(html).toContain("Public directory");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.onboarding).not.toHaveBeenCalled();
});
