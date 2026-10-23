import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as config } from "../../../../supabase/functions/_shared/managed-server-configuration";
import { readMyServersResponse } from "@/app/lib/hosting/my-servers";
import { createTranslator } from "@/app/lib/localization/translator";
import { ManagedServerControls } from "./ManagedServerControls";
import { ManagedServerConfigEditor } from "./ManagedServerConfigEditor";
import { TestLocalization, serverTestMessages } from "./ManagedServerLocalization.test-utils";

const mocks = vi.hoisted(() => ({ command: vi.fn(), config: vi.fn(), begin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/lib/localization/server", () => ({ getTranslations: async () => createTranslator("en", serverTestMessages["managed-server"]) }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: { id: "owner" } } }),
    getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "synthetic-access-token-with-enough-characters" } } }),
} }) }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({ ...await original<object>(), requestMyServerOperation: mocks.command }));
vi.mock("@/app/lib/hosting/server-configuration", () => ({ getMyServerConfiguration: mocks.config }));
vi.mock("./ServerManagementWorkspace", () => ({ useRevealServerAddress: () => vi.fn() }));
vi.mock("./ManagedServerPollingProvider", () => ({
    useManagedServerPolling: () => ({ session: null, timedOutSession: null, beginPolling: mocks.begin, endPolling: vi.fn() }),
    useManagedConsoleSignals: () => null, useManagedServerSaves: () => null, useManagedServerStatusSlot: () => undefined,
}));

const serverId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const error = { code: "server_suspended", message: "This server is suspended. Contact the hosting team for help.", retryable: false };

it.each(["start", "stop", "restart-game", "config-get"] as const)("renders the exact paired CP %s refusal with zero console errors", async route => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    const consoleError = vi.spyOn(console, "error");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const configuration = route === "config-get";
    const upstream: { url: string; method: string }[] = [];
    const edge = createMyServersHandler({ allowedOrigins: ["https://bannerlordcoop.com"], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {},
        fetchImplementation: async (input, init) => { upstream.push({ url: String(input), method: init?.method ?? "GET" }); return Response.json(configuration
            ? { version: 1, requestId, ok: false, error } : { ok: false, error }, { status: 409 }); } });
    async function normalized(configPart = "server") {
        const response = await edge(new Request(configuration
            ? `https://function.example.test?resource=config&serverId=${serverId}&configPart=${configPart}` : "https://function.example.test", {
            method: configuration ? "GET" : "POST", headers: { authorization: "Bearer synthetic-access-token-with-enough-characters",
                "content-type": "application/json", "x-request-id": requestId },
            ...(configuration ? {} : { body: JSON.stringify({ serverId, action: route }) }),
        }));
        return readMyServersResponse(response, requestId);
    }
    mocks.command.mockImplementation(() => normalized());
    mocks.config.mockImplementation((_token: string, _serverId: string, part: string) => normalized(part));
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<TestLocalization>{configuration
            ? <ManagedServerConfigEditor configuration={config} access={{ serverId, userId: "owner", canEdit: true }} />
            : <ManagedServerControls serverId={serverId} displayName="Campaign" accessRole="owner" expectedUpdatedAt="2026-10-01T00:00:00.000Z"
                operationState={route === "start" ? "stopped" : "running"} observedGameState={route === "start" ? "stopped" : "running"} />}</TestLocalization>));
        if (!configuration) await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === (route === "start" ? "Start" : route === "stop" ? "Stop" : "Restart"))!.click());
        expect(upstream).toHaveLength(configuration ? 2 : 1);
        expect(upstream.every(request => new URL(request.url).pathname === (configuration ? "/api/v1/config" : `/api/v1/${route === "restart-game" ? "restart" : route}`))).toBe(true);
        expect(container.textContent).toContain("This server is suspended. The request was refused and no change was made.");
        expect(container.textContent).not.toMatch(/couldn.t confirm|retry the same request|checking whether your server has stopped/i);
        expect(mocks.begin).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});
