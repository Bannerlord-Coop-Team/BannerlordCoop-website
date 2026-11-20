import { readFileSync } from "node:fs";
import { locales, type Locale } from "@/app/lib/localization/types";
import { beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import common from "@/app/lib/localization/dictionaries/en/server-common.json";
vi.mock("@/app/lib/localization/server", () => ({
    getTranslations: async (namespace: string) => createTranslator(mocks.locale, namespace === "server-common" ? common : readMessages(mocks.locale)),
}));
import { changeManagedServerCampaign, listManagedServerCampaigns, readManagedServerCampaignReset } from "./managed-server-campaign-actions";
import { CAMPAIGN_RESET_RUNNER_UPDATE_INSTRUCTION } from "../../../supabase/functions/_shared/server-campaign-contract";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), select: vi.fn(), reset: vi.fn(), resetStatus: vi.fn(), locale: "en" as Locale }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/server-campaigns", () => ({ listMyServerCampaigns: mocks.list, selectMyServerCampaign: mocks.select, resetMyServerCampaign: mocks.reset, getMyServerCampaignResetStatus: mocks.resetStatus }));
const id = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-10-02T12:00:00.000Z";
const page = { serverId: id, updatedAt, activeSaveId: id, items: [] };
function readMessages(locale: Locale) {
    return JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${locale}/managed-server.json`, "utf8"));
}
beforeEach(() => {
    vi.resetAllMocks();
    mocks.locale = "en";
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), getSession: async () => ({ data: { session: { access_token: "token" } } }) } });
});
it("checks the current account before listing or changing campaigns", async () => {
    expect((await listManagedServerCampaigns(id, "previous-owner")).ok).toBe(false);
    expect((await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt }, "previous-owner")).ok).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue(page);
    expect(await listManagedServerCampaigns(id, "owner")).toEqual({ ok: true, campaigns: page });
    expect(mocks.list).toHaveBeenCalledWith("token", id);
});

it("returns fixed reset refusal guidance through the authenticated campaign action, never re-submitting Reset", async () => {
    const status = { serverId: id, jobId: id, state: "failed", errorCode: "agent_capability_unavailable", instruction: CAMPAIGN_RESET_RUNNER_UPDATE_INSTRUCTION } as const;
    mocks.resetStatus.mockResolvedValue(status);
    expect(await readManagedServerCampaignReset(id, id, "owner")).toEqual({ ok: true, status, message: "Please create a General Help support ticket in https://discord.gg/5vJzfz5Zzy to request a runner update, then request Reset Campaign again." });
    expect(mocks.resetStatus).toHaveBeenCalledExactlyOnceWith("token", id, id);
    expect(mocks.reset).not.toHaveBeenCalled();
    mocks.resetStatus.mockClear();
    expect(await readManagedServerCampaignReset(id, id, "previous-owner")).toMatchObject({ ok: false, retryable: false });
    expect(mocks.resetStatus).not.toHaveBeenCalled();
    mocks.resetStatus.mockResolvedValue(null);
    expect(await readManagedServerCampaignReset(id, id, "owner")).toMatchObject({ ok: true, status: null, message: expect.stringContaining("not available") });
    mocks.resetStatus.mockRejectedValue(new MyServersApiError("forbidden", "private worker path"));
    expect(await readManagedServerCampaignReset(id, id, "owner")).toEqual({ ok: false, retryable: false, message: "This server is unavailable or your access changed." });
});
it("validates the mutation before sending and forwards the request identity", async () => {
    mocks.select.mockResolvedValue({ serverId: id, activeSaveId: id, updatedAt });
    expect(await changeManagedServerCampaign({ requestId: id, action: "select-save", serverId: id, saveId: id, expectedUpdatedAt: updatedAt }, "owner")).toEqual({ ok: true, selection: { serverId: id, activeSaveId: id, updatedAt } });
    expect(mocks.select).toHaveBeenCalledWith("token", id, { action: "select-save", serverId: id, saveId: id, expectedUpdatedAt: updatedAt });
    mocks.reset.mockResolvedValue({ outcome: "enqueued", jobId: id, action: "reset-campaign" });
    expect(await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt }, "owner")).toEqual({ ok: true, reset: { outcome: "enqueued", jobId: id, action: "reset-campaign" } });
    for (const invalid of [
        { requestId: "nope", action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt },
        { requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: "yesterday" },
        { requestId: id, action: "select-save", serverId: id, expectedUpdatedAt: updatedAt },
        { requestId: id, action: "delete-save", serverId: id, saveId: id, expectedUpdatedAt: updatedAt },
        { requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt, confirm: true },
    ]) expect(await changeManagedServerCampaign(invalid, "owner")).toMatchObject({ ok: false, notSubmitted: true });
    expect(mocks.select).toHaveBeenCalledTimes(1); expect(mocks.reset).toHaveBeenCalledTimes(1);
});
it("maps control plane rejections to guidance and marks state conflicts for refresh", async () => {
    for (const [code, fragment, refresh] of [
        ["safe_stop_required", "Stop the server", true],
        ["operation_in_progress", "still running", true],
        ["stale_interaction", "changed since this page loaded", true],
        ["first_start_required", "Start the server once", false],
        ["server_not_found", "unavailable or your access changed", false],
        ["control_plane_unavailable", "Temporarily down for maintenance.", false],
        ["server_api_unavailable", "could not be reached", false],
    ] as const) {
        mocks.reset.mockRejectedValueOnce(new MyServersApiError(code, "Rejected"));
        expect(await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt }, "owner"))
            .toMatchObject({ ok: false, notSubmitted: false, refresh, message: expect.stringContaining(fragment) });
    }
    mocks.list.mockRejectedValueOnce(new MyServersApiError("server_not_found", "Missing"));
    expect(await listManagedServerCampaigns(id, "owner")).toMatchObject({ ok: false, message: expect.stringContaining("unavailable") });
});
it("forwards a War Sails reset with warSails true and a Classic reset exactly as before", async () => {
    mocks.reset.mockResolvedValue({ outcome: "enqueued", jobId: id, action: "reset-campaign" });
    await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt }, "owner");
    await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt, warSails: false }, "owner");
    await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt, warSails: true }, "owner");
    const sent = mocks.reset.mock.calls.map(([, , input]) => JSON.stringify(input));
    const classic = JSON.stringify({ action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt });
    expect(sent).toEqual([classic, classic, JSON.stringify({ action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt, warSails: true })]);
    expect(await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt, warSails: "yes" }, "owner"))
        .toMatchObject({ ok: false, notSubmitted: true });
    expect(mocks.reset).toHaveBeenCalledTimes(3);
});
it("explains a War Sails capability refusal in the owner's language and lets them choose again", async () => {
    mocks.reset.mockRejectedValueOnce(new MyServersApiError("war_sails_unsupported", "Control plane English copy.", false, undefined, true));
    expect(await changeManagedServerCampaign({ requestId: id, action: "reset-campaign", serverId: id, expectedUpdatedAt: updatedAt, warSails: true }, "owner")).toEqual({ ok: false, notSubmitted: true, refresh: false,
        message: "This campaign uses War Sails, which this server's build can't run. Switch to the nightly channel or pick a Classic campaign." });
    mocks.select.mockRejectedValueOnce(new MyServersApiError("war_sails_save_mismatch", "Control plane English copy.", false, undefined, true));
    expect(await changeManagedServerCampaign({ requestId: id, action: "select-save", serverId: id, saveId: id, expectedUpdatedAt: updatedAt }, "owner"))
        .toMatchObject({ ok: false, message: "This campaign's War Sails mode doesn't match. Select or start a campaign in the right mode." });
});

it.each(locales)("localizes reset support messages in %s", async locale => {
    mocks.locale = locale;
    const dictionary = readMessages(locale);
    const invite = "https://discord.gg/5vJzfz5Zzy";
    for (const [errorCode, instruction, key] of [
        ["agent_capability_unavailable", CAMPAIGN_RESET_RUNNER_UPDATE_INSTRUCTION, "campaigns.resetRunnerHelp"],
        ["operation_failed", null, "campaigns.resetFailedHelp"],
    ] as const) {
        const status = { serverId: id, jobId: id, state: "failed", errorCode, instruction };
        mocks.resetStatus.mockResolvedValueOnce(status);
        expect(await readManagedServerCampaignReset(id, id, "owner")).toEqual({
            ok: true, status, message: dictionary[key].replace("{supportLink}", invite),
        });
        expect(dictionary[key]).toContain("General Help");
        expect(dictionary[key]).toContain("{supportLink}");
    }
    mocks.resetStatus.mockRejectedValueOnce(new MyServersApiError("server_api_unavailable", "private error"));
    expect(await readManagedServerCampaignReset(id, id, "owner")).toMatchObject({
        ok: false, message: dictionary["campaigns.resetStatusHelp"].replace("{supportLink}", invite),
    });
    expect(dictionary["campaigns.resetStatusHelp"]).toContain("{supportLink}");
    expect(dictionary["campaigns.resetOutcomeHelp"]).toContain("{supportLink}");
    expect(mocks.reset).not.toHaveBeenCalled();
});
