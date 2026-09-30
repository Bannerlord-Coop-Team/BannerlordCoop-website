import { renderToReadableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { onboardingSummary, ONBOARDING_TEST_ID } from "../../../tests/onboarding-fixtures";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), onboarding: vi.fn(), publicList: vi.fn(), account: vi.fn(), displayNames: vi.fn(), navbar: vi.fn() }));
vi.mock("@/app/lib/hosting/website-account-status", () => ({ getWebsiteAccountStatus: mocks.account }));
vi.mock("@/app/lib/hosting/public-servers", () => ({ listPublicServers: mocks.publicList }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerViewer: async (options?: { onReadOnlySession?: (token: string) => unknown }) => {
    const client = await mocks.auth();
    const { data: { session } } = await client.auth.getSession();
    const read = session ? options?.onReadOnlySession?.(session.access_token) : undefined;
    const { data: { user } } = await client.auth.getUser();
    return { client, user, read, accessToken: user && session?.user.id === user.id ? session.access_token : null };
} }));
vi.mock("@/app/lib/hosting/my-servers", () => ({ listAllMyServers: mocks.list, getServerOnboarding: mocks.onboarding }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: (props: unknown) => { mocks.navbar(props); return <nav>Navigation</nav>; } }));
vi.mock("@/app/components/servers/ServerOnboarding", () => ({ ServerOnboarding: ({ userId, summary }: { userId: string; summary: unknown }) => <div data-user={userId}>{summary ? "Trusted onboarding snapshot" : "Unavailable snapshot"}</div>, GamePasswordNotice: () => <p>Discord password controls</p> }));
vi.mock("@/app/lib/console/servers", () => ({ listLiveConsoleServers: () => [{ id: "live-one", name: "Live campaign" }] }));
vi.mock("@/app/lib/auth/access", () => ({ getLiveConsoleAccessLevel: () => "owner" }));
vi.mock("@/app/lib/hosting/server-settings", () => ({ getServerDisplayNames: mocks.displayNames }));
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
    mocks.displayNames.mockResolvedValue(new Map());
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444", identities: [{ provider: "discord", identity_data: { sub: "123456789012345678" } }] } } }), getSession: async () => ({ data: { session: { access_token: "test-page-jwt", user: { id: "44444444-4444-4444-8444-444444444444" } } } }) } });
    mocks.list.mockResolvedValue([{ serverId: ONBOARDING_TEST_ID, displayName: "Assigned campaign", operationState: "stopped", observedGameState: "stopped", accessRole: "owner" }]);
    mocks.onboarding.mockResolvedValue(onboardingSummary());
    mocks.publicList.mockResolvedValue([]);
});
it("real servers page keeps mixed managed/live inventory and trusted onboarding separate from the public directory", async () => {
    const html = await renderPage();
    expect(html).toContain("Trusted onboarding snapshot"); expect(html).toContain('data-user="44444444-4444-4444-8444-444444444444"');
    expect(html).toContain("Assigned campaign"); expect(html).toContain("Live campaign"); expect(html).toContain("Public directory");
    expect(html).toContain(`/servers/${ONBOARDING_TEST_ID}`); expect(html).toContain("Offline");
    expect(mocks.onboarding).toHaveBeenCalledWith("test-page-jwt"); expect(mocks.list).toHaveBeenCalledWith("test-page-jwt", expect.any(AbortSignal));
});
it("shares the verified viewer and client within one render, then reads the next session afresh", async () => {
    await renderPage();
    const first = await mocks.navbar.mock.calls[0][0].viewer;
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    const client = await mocks.auth.mock.results[0].value;
    expect(mocks.account).toHaveBeenCalledWith(first.user.id, "test-page-jwt", client);
    expect(Object.keys(first)).toEqual(["user"]);

    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) } });
    const html = await renderPage();
    const second = await mocks.navbar.mock.calls[1][0].viewer;
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    expect(second.user).toBeNull();
    expect(Object.keys(second)).toEqual(["user"]);
    expect(mocks.account).toHaveBeenCalledTimes(1);
    expect(html).toContain("Sign in to view");
    expect(html).not.toContain("Assigned campaign");
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


it.each(["auth", "account", "onboarding", "displayNames"] as const)("streams the public directory while %s is pending", async (dependency) => {
    const pending = Promise.withResolvers<unknown>();
    // Hold a real dependency indefinitely: the public section must arrive without it.
    mocks[dependency].mockReturnValueOnce(pending.promise);
    const stream = await renderToReadableStream(await ServersPage());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let html = "";
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
            expect(mocks.displayNames).not.toHaveBeenCalled();
        } else {
            await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledExactlyOnceWith("test-page-jwt", expect.any(AbortSignal)));
            if (dependency !== "displayNames") {
                await readUntil("Assigned campaign");
                expect(html).not.toContain("Trusted onboarding snapshot");
            }
            if (dependency === "account") expect(mocks.onboarding).not.toHaveBeenCalled();
        }
        expect(mocks.publicList).toHaveBeenCalledTimes(1);
    } finally {
        // Exercise the existing failure fallbacks after proving independence.
        if (dependency === "displayNames") pending.resolve(new Map());
        else pending.reject(new Error("Dependency unavailable"));
        await stream.allReady;
        reader.releaseLock();
    }
});

it("discards the independently authorized read if the fresh viewer differs from the session", async () => {
    mocks.auth.mockResolvedValue({ auth: {
        getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444" } } }),
        getSession: async () => ({ data: { session: { access_token: "other-user-token", user: { id: ONBOARDING_TEST_ID } } } }),
    } });
    const html = await renderPage();
    expect(html).toContain("Your authenticated server session is unavailable");
    expect(html).toContain("Public directory");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("other-user-token", expect.any(AbortSignal));
    expect(mocks.list.mock.calls[0][1].aborted).toBe(true);
    expect(html).not.toContain("Assigned campaign");
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.onboarding).not.toHaveBeenCalled();
});

it("starts owner inventory during viewer verification but streams it only after matching verification", async () => {
    const client = await mocks.auth();
    const verified = await client.auth.getUser();
    const gate = Promise.withResolvers<typeof verified>();
    client.auth.getUser = () => gate.promise;
    const stream = await renderToReadableStream(ServersPage());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let html = "";
    try {
        while (!html.includes("Public directory</div>")) {
            const chunk = await reader.read();
            if (chunk.done) break;
            html += decoder.decode(chunk.value, { stream: true });
        }
        expect(html).toContain("Public directory</div>");
        expect(mocks.list).toHaveBeenCalledExactlyOnceWith("test-page-jwt", expect.any(AbortSignal));
        expect(html).not.toContain("Assigned campaign");
        expect(mocks.account).not.toHaveBeenCalled();
        expect(mocks.onboarding).not.toHaveBeenCalled();
        gate.resolve(verified);
        while (!html.includes("Assigned campaign")) {
            const chunk = await reader.read();
            if (chunk.done) break;
            html += decoder.decode(chunk.value, { stream: true });
        }
        expect(html).toContain("Assigned campaign");
        expect(mocks.list).toHaveBeenCalledTimes(1);
    } finally {
        gate.resolve(verified);
        await stream.allReady;
        reader.releaseLock();
    }
});

it.each(["revoked", "unavailable"])("cancels an early private read when viewer verification is %s", async (failure) => {
    const client = await mocks.auth();
    client.auth.getUser = async () => {
        if (failure === "unavailable") throw new Error("Viewer unavailable");
        return { data: { user: null } };
    };
    mocks.list.mockImplementation((_token: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Cancelled read")), { once: true });
    }));
    const html = await renderPage();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list.mock.calls[0][1].aborted).toBe(true);
    expect(html).not.toContain("Assigned campaign");
    expect(html).toContain("Sign in to view");
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.onboarding).not.toHaveBeenCalled();
});
