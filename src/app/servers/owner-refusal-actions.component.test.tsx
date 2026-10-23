import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import messages from "@/app/lib/localization/dictionaries/en/managed-server.json";
import { MyServersApiError, readMyServersResponse } from "@/app/lib/hosting/my-servers";
import { ownerRefusalMessage } from "@/app/lib/hosting/owner-refusal";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as config } from "../../../supabase/functions/_shared/managed-server-configuration";
import { operateManagedServer, setManagedServerPassword } from "./managed-server-actions";
import { submitManagedServerFile, exportManagedServerConfig, downloadManagedServerSave } from "./managed-server-file-actions";
import { saveManagedServerConfig } from "./managed-server-config-actions";
import { submitManagedConsoleCommand } from "./managed-server-console-actions";
import { changeManagedServerCampaign } from "./managed-server-campaign-actions";
import { deleteManagedServerSave, selectManagedServerSave } from "./managed-server-save-actions";
import { manageServerBackup } from "./managed-server-backup-actions";
import { changeServerRelease } from "./server-release-actions";
import { saveServerSettings } from "./server-settings-actions";
import { setServerVisibility } from "./server-visibility-actions";
import { deleteManagedServer } from "./server-deletion-actions";
import { setServerManager, removeServerManager } from "./server-manager-actions";
import { dismissManagedServerNotice } from "./server-notice-actions";

const mocks = vi.hoisted(() => ({ call: vi.fn(), locale: "en" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/localization/server", () => ({ getTranslations: async () => createTranslator("en",
    JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${mocks.locale}/managed-server.json`, "utf8"))) }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: { id: "owner" } } }),
    getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "synthetic" } } }),
} }) }));
vi.mock("@/app/lib/supabase/users", () => ({ findWebsiteAccountByEmail: async () => ({ accountId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({
    getMyServerSummary: async () => ({ accessRole: "owner", updatedAt: "2026-10-01T00:00:00.000Z" }),
}));
vi.mock("@/app/lib/hosting/my-servers", async original => ({
    ...await original<object>(),
    requestMyServerOperation: mocks.call, requestMyServerPassword: mocks.call, requestMyServerUpdate: mocks.call,
    requestMyServerBackupOperation: mocks.call, requestMyServerRelease: mocks.call, requestMyServerSettings: mocks.call,
    requestServerVisibility: mocks.call, requestMyServerDeletion: mocks.call, requestMyServerManager: mocks.call,
    dismissServerNotice: mocks.call, deleteMyServerSave: mocks.call, selectMyServerSave: mocks.call,
}));
vi.mock("@/app/lib/hosting/server-files", () => ({
    submitMyServerFile: mocks.call, getMyServerFiles: mocks.call, downloadMyServerSave: mocks.call,
}));
vi.mock("@/app/lib/hosting/server-configuration", () => ({ saveMyServerConfiguration: mocks.call }));
vi.mock("@/app/lib/hosting/server-console", () => ({ submitMyServerConsoleCommand: mocks.call }));
vi.mock("@/app/lib/hosting/server-campaigns", () => ({ selectMyServerCampaign: mocks.call, resetMyServerCampaign: mocks.call }));

const id = "11111111-1111-4111-8111-111111111111";
const common = { serverId: id, expectedUpdatedAt: "2026-10-01T00:00:00.000Z" };
const receipt = { ...common, requestId: id };
type Result = { ok: boolean; message?: string; rejected?: boolean; notSubmitted?: boolean; retrySameRequest?: boolean; uncertain?: boolean; checkStatus?: boolean };
function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
}
function transfer(action: string) {
    const data = form({ ...receipt, action, ...(action === "export-save" ? { saveId: id } : {}) });
    if (action === "import-config") {
        data.set("config", new File([JSON.stringify(config)], "config.json"));
        Object.defineProperty(data.get("config"), "text", { value: async () => JSON.stringify(config) });
    }
    if (action === "import-save") {
        data.set("displayName", "Campaign");
        data.append("files", new File(["synthetic"], "Campaign.blcexport"));
        Object.defineProperty(data.get("files"), "arrayBuffer", { value: async () => new TextEncoder().encode("synthetic").buffer });
    }
    return submitManagedServerFile(data, "owner");
}

const handlers: [string, () => Promise<Result>, Partial<Result>][] = [
    ...["start", "stop", "restart-game"].map(action => [action, () => operateManagedServer({ serverId: id, action }), { checkStatus: undefined }] as [string, () => Promise<Result>, Partial<Result>]),
    ["update", () => operateManagedServer({ ...common, action: "update-now" }), {}],
    ["password", () => setManagedServerPassword({ ...common, password: "test" }), { checkStatus: undefined }],
    ...["import-config", "import-save", "export-save"].map(action => [action, () => transfer(action), { rejected: true }] as [string, () => Promise<Result>, Partial<Result>]),
    ["export-config", () => exportManagedServerConfig(id, "owner"), { rejected: true }],
    ["download-save", () => downloadManagedServerSave(id, id, "owner"), { rejected: true }],
    ["config", () => saveManagedServerConfig({ requestId: id, serverId: id, configPart: "server", expectedRevision: "a".repeat(64), settings: config.serverConfig }, "owner"), { notSubmitted: true }],
    ["console", () => submitManagedConsoleCommand({ ...common, command: "coop.help" }, id, "owner"), { uncertain: false }],
    ["campaign-select", () => changeManagedServerCampaign({ ...receipt, action: "select-save", saveId: id }, "owner"), { notSubmitted: true }],
    ["campaign-reset", () => changeManagedServerCampaign({ ...receipt, action: "reset-campaign" }, "owner"), { notSubmitted: true }],
    ["save-select", () => selectManagedServerSave({ ...receipt, saveId: id }, "owner"), {}],
    ["save-delete", () => deleteManagedServerSave({ ...receipt, saveId: id, confirmationText: "Campaign" }, "owner"), { notSubmitted: true }],
    ["backup", () => manageServerBackup({ ...receipt, action: "create-backup" }, "owner"), { retrySameRequest: false }],
    ["restore-backup", () => manageServerBackup({ ...receipt, action: "restore-backup", backupId: id }, "owner"), { retrySameRequest: false }],
    ["restore-autosave", () => manageServerBackup({ ...receipt, action: "restore-save-generation", saveId: id, generation: "backup1" }, "owner"), { retrySameRequest: false }],
    ["release", () => changeServerRelease({ ...receipt, releaseChannel: "nightly" }), { rejected: true }],
    ["settings", () => saveServerSettings({ ...receipt, patch: { displayName: "Campaign" } }), { rejected: true }],
    ["visibility", () => setServerVisibility({ ...receipt, visibility: "public" }), { rejected: true }],
    ["delete", () => deleteManagedServer({ ...receipt, confirmationText: "Campaign" }), { rejected: true }],
    ["manager-add", () => setServerManager(form({ serverId: id, managerEmail: "test@example.com" })), {}],
    ["manager-remove", () => removeServerManager(form({ serverId: id, managerAccountId: id })), {}],
    ["dismiss-notice", () => dismissManagedServerNotice({ serverId: id, noticeId: id }), {}],
];

async function envelopeError(code: string, retryable = false, operationId?: string) {
    try {
        await readMyServersResponse(Response.json({ version: 1, requestId: id, ok: false,
            error: { code, message: "The request was refused.", retryable, ...(operationId ? { operationId } : {}) } }, { status: 409 }), id);
    } catch (error) { return error; }
    throw new Error("Expected refusal");
}
beforeEach(() => { vi.clearAllMocks(); mocks.locale = "en"; });

for (const [name, run, settlement] of handlers) {
    it(`${name}: renders a parsed 409 suspension and settles only the refused request`, async () => {
        mocks.call.mockRejectedValue(await envelopeError("server_suspended"));
        const result = await run();
        expect(mocks.call).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ ok: false, message: messages["action.refusal.serverSuspended"] });
        for (const [key, value] of Object.entries(settlement)) expect(result[key as keyof Result]).toBe(value);
        expect(result.message).not.toMatch(/unknown|unconfirmed|retry|could not be confirmed/i);
    });
    it(`${name}: shows another known admission refusal`, async () => {
        mocks.call.mockRejectedValue(await envelopeError("operation_unavailable"));
        const translated = name === "console" ? messages["action.console.theServerIsnTRunningSoTheCommandCanT"]
            : ["backup", "restore-backup", "restore-autosave"].includes(name) ? messages["action.backup.thatBackupOperationIsNotAvailableInTheServerS"]
            : name.startsWith("campaign-") ? "Campaign changes are not available for this server right now." : "The request was refused.";
        expect(await run()).toMatchObject({ ok: false, message: translated });
        expect(mocks.call).toHaveBeenCalledOnce();
    });
    it(`${name}: keeps retryable suspension failures on the existing recovery path`, async () => {
        mocks.call.mockRejectedValue(await envelopeError("server_suspended", true));
        const result = await run();
        expect(mocks.call).toHaveBeenCalledOnce();
        expect(result.message).not.toBe(messages["action.refusal.serverSuspended"]);
        expect(result.rejected).not.toBe(true);
        expect(result.notSubmitted).not.toBe(true);
        expect(result.retrySameRequest).not.toBe(false);
        expect(result.uncertain).not.toBe(false);
    });
    it(`${name}: preserves the exact existing unknown response for network, timeout, unenveloped 5xx and malformed body`, async () => {
        mocks.call.mockRejectedValue(new Error("Network lost"));
        const baseline = await run();
        for (const response of [new Response("Gateway timeout", { status: 504 }), new Response("{", { status: 409 })]) {
            let failure: unknown;
            try { await readMyServersResponse(response, id); } catch (error) { failure = error; }
            mocks.call.mockRejectedValue(failure);
            expect(await run()).toEqual(baseline);
        }
        mocks.call.mockRejectedValue(new DOMException("Timeout", "TimeoutError"));
        expect(await run()).toEqual(baseline);
    });
}

it("does not classify retryable, accepted-job, local, future or pre-replay authority failures as definitive", async () => {
    const t = createTranslator("en", messages).t;
    for (const error of [
        await envelopeError("server_suspended", true), await envelopeError("server_suspended", false, id),
        await envelopeError("operation_timeout"), await envelopeError("request_conflict"), await envelopeError("forbidden"),
        await envelopeError("server_not_found"), await envelopeError("future_error"),
        new MyServersApiError("server_suspended", "Local error"), new Error("Network"),
    ]) expect(ownerRefusalMessage(error, t)).toBeNull();
});

it.each(["import-config", "import-save", "export-save"])("retains the exact %s request after a parsed same-ID operation_in_progress", async action => {
    mocks.call.mockRejectedValue(await envelopeError("operation_in_progress"));
    expect(await transfer(action)).toMatchObject({ ok: false, rejected: false, notSubmitted: false,
        message: messages["action.file.theTransferOutcomeCouldNotBeConfirmedCheckItsStatus"] });
    expect(mocks.call).toHaveBeenCalledOnce();
});

it.each([
    ["update", "no_update_available"], ["update", "validated_build_unavailable"], ["update", "operation_in_progress"],
    ["backup", "safe_stop_required"], ["backup", "operation_in_progress"], ["backup", "backup_build_mismatch"],
    ["import-save", "safe_stop_required"], ["console", "operation_unavailable"], ["save-delete", "save_still_loaded"],
    ["release", "nightly_unavailable"], ["release", "validated_build_unavailable"],
    ["settings", "operation_in_progress"], ["delete", "operation_in_progress"], ["dismiss-notice", "impersonation_read_only"],
])("preserves existing German copy and action flags for %s / %s", async (name, code) => {
    mocks.locale = "de";
    const run = handlers.find(([handler]) => handler === name)![1];
    mocks.call.mockRejectedValue(new MyServersApiError(code, "The request was refused."));
    const existing = await run();
    mocks.call.mockRejectedValue(await envelopeError(code));
    expect(await run()).toEqual(existing);
    expect(existing.message).not.toBe("The request was refused.");
});

it.each(["safe_stop_required", "save_not_found"])("keeps the campaign refresh for definitive %s", async code => {
    mocks.call.mockRejectedValue(await envelopeError(code));
    expect(await changeManagedServerCampaign({ ...receipt, action: "reset-campaign" }, "owner"))
        .toMatchObject({ ok: false, notSubmitted: true, refresh: true });
});

it.each(["nightly_unavailable", "validated_build_unavailable", "release_compatibility_unknown", "release_compatibility_unsafe"])("keeps German release copy after the fresh-revision retry: %s", async code => {
    mocks.locale = "de";
    const input = { ...receipt, releaseChannel: "nightly", previousChannel: "stable" };
    mocks.call.mockRejectedValueOnce(await envelopeError(code));
    const existing = await changeServerRelease(input);
    const summary = await import("@/app/lib/hosting/my-servers-server");
    vi.spyOn(summary, "getMyServerSummary").mockResolvedValueOnce({ accessRole: "owner", releaseChannel: "stable", updatedAt: "2026-10-01T00:00:01.000Z" } as never);
    mocks.call.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "Stale"))
        .mockRejectedValueOnce(await envelopeError(code));
    expect(await changeServerRelease(input)).toEqual(existing);
    expect(existing.message).not.toBe("The request was refused.");
    expect(mocks.call).toHaveBeenCalledTimes(3);
});
it.each(readdirSync("src/app/lib/localization/dictionaries"))("ships suspension copy in %s", locale => {
    const dictionary = JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${locale}/managed-server.json`, "utf8"));
    expect(dictionary["action.refusal.serverSuspended"]).toBeTypeOf("string");
    expect(dictionary["action.refusal.serverSuspended"].length).toBeGreaterThan(20);
    expect(dictionary["mods.error.uploadStatusUnavailable"]).toBeTypeOf("string");
    expect(dictionary["mods.error.uploadStatusUnavailable"]).toContain("{id}");
});

