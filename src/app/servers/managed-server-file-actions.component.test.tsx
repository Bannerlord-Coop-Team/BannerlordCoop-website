import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { submitManagedServerFile, exportManagedServerConfig, checkManagedServerFile, readManagedServerFileStatus } from "./managed-server-file-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as config } from "../../../supabase/functions/_shared/managed-server-configuration";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), submit: vi.fn(), files: vi.fn(), status: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/server-files", () => ({ submitMyServerFile: mocks.submit, getMyServerFiles: mocks.files, getMyServerFileResult: mocks.status, downloadMyServerSave: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
const id = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-09-13T00:00:00.000Z";
beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), getSession: async () => ({ data: { session: { access_token: "original-owner-token" } } }) } });
});
it("checks current account before returning configuration or transfer status", async () => {
    expect((await exportManagedServerConfig(id, "previous-owner")).ok).toBe(false);
    expect((await checkManagedServerFile(id, id, "previous-owner")).ok).toBe(false);
    expect(mocks.files).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
    mocks.files.mockResolvedValue({ managedConfig: config });
    expect(await exportManagedServerConfig(id, "owner")).toEqual({ ok: true, managedConfig: config });
    expect(mocks.files).toHaveBeenCalledWith("original-owner-token", id);
});
it("forwards exact original identity/generation and validates configuration again in the server action", async () => {
    const result = { kind: "configuration", outcome: "updated", updatedAt };
    mocks.submit.mockResolvedValue(result);
    const file = new File([JSON.stringify(config)], "config.json", { type: "application/json" });
    Object.defineProperty(file, "text", { configurable: true, value: async () => JSON.stringify(config) });
    const form = new FormData();
    for (const [key, value] of Object.entries({ action: "import-config", requestId: id, serverId: id, expectedUpdatedAt: updatedAt })) form.set(key, value);
    form.set("config", file);
    // jsdom preserves the original File when no replacement filename is supplied.
    const stored = form.get("config") as File;
    Object.defineProperty(stored, "text", { configurable: true, value: async () => JSON.stringify(config) });
    expect(await submitManagedServerFile(form, "owner")).toEqual({ ok: true, result });
    expect(mocks.submit).toHaveBeenCalledWith("original-owner-token", id, { action: "import-config", serverId: id, expectedUpdatedAt: updatedAt, managedConfig: config });
    mocks.submit.mockClear();
    Object.defineProperty(stored, "text", { value: async () => JSON.stringify({ ...config, password: "forbidden" }) });
    expect(await submitManagedServerFile(form, "owner")).toMatchObject({ ok: false, notSubmitted: true });
    expect(mocks.submit).not.toHaveBeenCalled();
});
it("rejects oversize config before reading bytes and preserves unknown transport failures", async () => {
    const file = new File(["x".repeat(65537)], "config.json");
    const form = new FormData();
    form.set("action", "import-config"); form.set("requestId", id); form.set("config", file);
    expect(await submitManagedServerFile(form, "owner")).toMatchObject({ ok: false, notSubmitted: true }); expect(mocks.submit).not.toHaveBeenCalled();
    mocks.status.mockRejectedValue(new Error("Lost connection"));
    expect(await checkManagedServerFile(id, id, "owner")).toMatchObject({ ok: false, rejected: false });
});

it("strips native private fields before forwarding an individual server configuration", async () => {
    const result = { kind: "configuration", outcome: "updated", updatedAt };
    mocks.submit.mockResolvedValue(result);
    const form = new FormData();
    for (const [key, value] of Object.entries({ action: "import-config", requestId: id, serverId: id, expectedUpdatedAt: updatedAt, configPart: "server" })) form.set(key, value);
    const file = new File(["config"], "server-config.json");
    Object.defineProperty(file, "text", { value: async () => '{"autosaveMinutes":10,"password":"private", "port":4200, "saveName":"campaign",}' });
    form.set("config", file);
    expect(await submitManagedServerFile(form, "owner")).toEqual({ ok: true, result });
    expect(mocks.submit).toHaveBeenCalledWith("original-owner-token", id, { action: "import-config", serverId: id, expectedUpdatedAt: updatedAt, configPart: "server", settings: { autosaveMinutes: 10 } });
});

it("distinguishes local campaign validation from an uncertain upstream submission", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ action: "import-save", requestId: id, serverId: id, expectedUpdatedAt: updatedAt, displayName: "Bad\u200BName" })) form.set(key, value);
    const file = new File(["save"], "campaign.blcexport");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
    form.append("files", file);
    expect(await submitManagedServerFile(form, "owner")).toMatchObject({ ok: false, notSubmitted: true });
    expect(mocks.submit).not.toHaveBeenCalled();
    form.set("displayName", "Corrected campaign");
    mocks.submit.mockRejectedValueOnce(new Error("Response lost after acceptance"));
    expect(await submitManagedServerFile(form, "owner")).toMatchObject({ ok: false, notSubmitted: false, rejected: false });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    mocks.submit.mockResolvedValue({ kind: "job", action: "import-save", state: "queued" });
    mocks.revalidate.mockImplementation(() => { throw new Error("Refresh failed after acceptance"); });
    expect(await submitManagedServerFile(form, "owner")).toMatchObject({ ok: false, notSubmitted: false, rejected: false });
});

it("marks only a submitted stale rejection as stale so the page can refresh and retry an export", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ action: "export-save", requestId: id, serverId: id, expectedUpdatedAt: updatedAt, saveId: id })) form.set(key, value);
    mocks.submit.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "Stale page"));
    expect(await submitManagedServerFile(form, "owner")).toMatchObject({ ok: false, rejected: true, stale: true, notSubmitted: false });
    mocks.submit.mockRejectedValueOnce(new MyServersApiError("safe_stop_required", "Running"));
    expect(await submitManagedServerFile(form, "owner")).toMatchObject({ ok: false, rejected: true, stale: false });
    expect(await submitManagedServerFile(form, "previous-owner")).toMatchObject({ ok: false, notSubmitted: true, stale: false });
});

it("reads current transfer status for the authenticated page account only", async () => {
    const status = { serverId: id, updatedAt, operationState: "running", observedGameState: "running", activeSave: null, managedConfig: config };
    mocks.files.mockResolvedValue(status);
    expect(await readManagedServerFileStatus(id, "previous-owner")).toMatchObject({ ok: false });
    expect(await readManagedServerFileStatus("not-a-uuid", "owner")).toMatchObject({ ok: false });
    expect(mocks.files).not.toHaveBeenCalled();
    expect(await readManagedServerFileStatus(id, "owner")).toEqual({ ok: true, status });
    expect(mocks.files).toHaveBeenCalledExactlyOnceWith("original-owner-token", id);
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
