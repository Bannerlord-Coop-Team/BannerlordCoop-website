import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as config } from "../../../../supabase/functions/_shared/managed-server-configuration";
import { readMyServersResponse } from "@/app/lib/hosting/my-servers";
import { createTranslator } from "@/app/lib/localization/translator";
import { ManagedServerControls } from "./ManagedServerControls";
import { ManagedServerTransfers } from "./ManagedServerTransfers";
import refusalCapture from "../../../../test/fixtures/managed-config-refusals-v1.json";
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
vi.mock("@/app/lib/hosting/server-configuration", async original => ({
    ...await original<object>(), getMyServerConfiguration: mocks.config,
}));
vi.mock("@/app/lib/hosting/server-mods-api", () => ({ requestServerMods: async () => { throw new Error("No catalog in this fixture"); } }));
vi.mock("./ServerManagementWorkspace", () => ({ useRevealServerAddress: () => vi.fn(), useServerWorkspaceSectionShown: () => false }));
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

it.each(["direct save", "import"] as const)("renders the captured CP installed-build refusal for %s", async operation => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const direct = operation === "direct save";
    const capture = direct ? refusalCapture.direct : refusalCapture.imported;
    const change = { clansAfterKingdomDestruction: "KeepClans" };
    const revision = "a".repeat(64);
    const updatedAt = "2026-11-21T00:00:00.000Z";
    const token = "synthetic-access-token-with-enough-characters";
    const settings = { ...config.modConfig, modOptions: { ...config.modConfig.modOptions, ...change } };
    const expectedInput = direct
        ? { requestId: capture.body.requestId, serverId, configPart: "mod", expectedRevision: revision, settings }
        : { version: 1, requestId: capture.body.requestId, operation: "file-transfer", input: {
            action: "import-config", serverId, expectedUpdatedAt: updatedAt, configPart: "mod", settings: { modOptions: change },
        } };
    const forward = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe(`https://control-plane.example.test${direct ? "/api/v1/config" : "/v1/user/files"}`);
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(init?.headers).toEqual({
            authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": capture.body.requestId,
        });
        expect(JSON.parse(String(init?.body))).toEqual(expectedInput);
        return Response.json(capture.body, { status: capture.status });
    });
    const edge = createMyServersHandler({ allowedOrigins: ["https://bannerlordcoop.com"], controlPlaneUrl: "https://control-plane.example.test",
        waitUntil: () => {}, fetchImplementation: forward });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://function.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
    vi.stubGlobal("fetch", (url: URL, init: RequestInit) => edge(new Request(url, init)));
    vi.stubGlobal("crypto", { randomUUID: () => capture.body.requestId, subtle: webcrypto.subtle });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
    sessionStorage.clear();
    mocks.config.mockImplementation((_token, _serverId, part) => ({ configPart: part, revision, settings: part === "mod" ? config.modConfig : config.serverConfig }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const click = async (label: string) => {
        const button = [...container.querySelectorAll("button")].find(node => node.textContent === label);
        expect(button?.disabled, container.textContent ?? "").toBe(false);
        await act(async () => button!.click());
    };
    const choose = async (selector: string, value: string) => {
        const select = container.querySelector<HTMLSelectElement>(selector)!;
        await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
    };
    try {
        await act(async () => root.render(<TestLocalization>{direct
            ? <ManagedServerConfigEditor configuration={config} access={{ serverId, userId: "owner", canEdit: true }} />
            : <ManagedServerTransfers serverId={serverId} userId="owner" canImportConfig canExportSave={false}
                status={{ serverId, updatedAt, managedConfig: config, operationState: "stopped", observedGameState: "stopped", activeSave: null }} />}
        </TestLocalization>));
        if (direct) {
            await choose("#config-modOptions-clansAfterKingdomDestruction", "KeepClans");
            await click("Save config");
        } else {
            await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
            await click("Import config");
            await choose("dialog select", "mod");
            const contents = JSON.stringify({ modOptions: change });
            const file = new File([contents], "mod-config.json", { type: "application/json" });
            Object.defineProperty(file, "text", { value: async () => contents });
            Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(contents).buffer });
            const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
            Object.defineProperty(input, "files", { value: [file] });
            await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
            await click("Review import");
            await click("Import these settings");
        }
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(container.textContent).toContain(refusalCapture.direct.body.error.message);
        });
        expect(forward).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    }
});
