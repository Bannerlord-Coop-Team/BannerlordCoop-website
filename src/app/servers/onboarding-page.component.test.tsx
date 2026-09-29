import { renderToReadableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { onboardingSummary, ONBOARDING_TEST_ID } from "../../../tests/onboarding-fixtures";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), onboarding: vi.fn(), publicList: vi.fn() }));
vi.mock("@/app/lib/hosting/public-servers", () => ({ listPublicServers: mocks.publicList }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", () => ({ listAllMyServers: mocks.list, getServerOnboarding: mocks.onboarding }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => <nav>Navigation</nav> }));
vi.mock("@/app/components/servers/ServerOnboarding", () => ({ ServerOnboarding: ({ userId, summary }: { userId: string; summary: unknown }) => <div data-user={userId}>{summary ? "Trusted onboarding snapshot" : "Unavailable snapshot"}</div>, GamePasswordNotice: () => <p>Discord password controls</p> }));
vi.mock("@/app/lib/console/servers", () => ({ listLiveConsoleServers: () => [{ id: "live-one", name: "Live campaign" }] }));
vi.mock("@/app/lib/auth/access", () => ({ getLiveConsoleAccessLevel: () => "owner" }));
vi.mock("@/app/lib/hosting/server-settings", () => ({ getServerDisplayNames: async () => new Map() }));
vi.mock("@/app/components/servers/AllServersDirectory", () => ({ AllServersDirectory: () => <div>Public directory</div> }));
import ServersPage from "./page";
/** Collects the completed streamed page for existing content regressions. */
async function renderPage() {
    const stream = await renderToReadableStream(await ServersPage());
    await stream.allReady;
    return new Response(stream).text();
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "page-user", identities: [{ provider: "discord", identity_data: { sub: "123456789012345678" } }] } } }), getSession: async () => ({ data: { session: { access_token: "test-page-jwt", user: { id: "page-user" } } } }) } });
    mocks.list.mockResolvedValue([{ serverId: ONBOARDING_TEST_ID, displayName: "Assigned campaign", operationState: "stopped", observedGameState: "stopped", accessRole: "owner" }]);
    mocks.onboarding.mockResolvedValue(onboardingSummary());
    mocks.publicList.mockResolvedValue([]);
});
it("real servers page keeps mixed managed/live inventory and trusted onboarding separate from the public directory", async () => {
    const html = await renderPage();
    expect(html).toContain("Trusted onboarding snapshot"); expect(html).toContain('data-user="page-user"');
    expect(html).toContain("Assigned campaign"); expect(html).toContain("Live campaign"); expect(html).toContain("Public directory");
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

it("missing Discord is composed before CP allocation fetch, while existing inventory stays accessible", async () => {
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "page-user", identities: [] } } }), getSession: async () => ({ data: { session: { access_token: "test-page-jwt", user: { id: "page-user" } } } }) } });
    const html = await renderPage();
    expect(mocks.onboarding).not.toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalled(); expect(html).toContain("Assigned campaign");
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
        expect(shell).not.toContain("Live campaign");
        expect(shell).not.toContain("Public directory</div>");
        if (first === "managed") managed.resolve([]);
        else publicServers.resolve([]);
        let chunk = "";
        const expected = first === "managed" ? "Live campaign" : "Public directory</div>";
        while (!chunk.includes(expected)) {
            const next = await reader.read();
            if (next.done) break;
            chunk += decoder.decode(next.value, { stream: true });
        }
        expect(chunk).toContain(expected);
        expect(chunk).not.toContain(first === "managed" ? "Public directory</div>" : "Live campaign");
        expect(mocks.list).toHaveBeenCalledTimes(1);
        expect(mocks.publicList).toHaveBeenCalledTimes(1);
    } finally {
        managed.resolve([]);
        publicServers.resolve([]);
        await stream.allReady;
        reader.releaseLock();
    }
});
