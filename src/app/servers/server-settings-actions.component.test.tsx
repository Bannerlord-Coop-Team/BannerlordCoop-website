import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { saveServerSettings } from "./server-settings-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({ ...await original<typeof import("@/app/lib/hosting/my-servers")>(), requestMyServerSettings: mocks.save }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
const serverId = "11111111-1111-4111-8111-111111111111";
const input = { serverId, expectedUpdatedAt: "2026-10-01T00:00:00.000Z", patch: { maintenanceSlot: "10:00-11:00" }, requestId: serverId };
beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "verified-token" } } }) } });
    mocks.save.mockResolvedValue({ outcome: "updated", serverId, updatedAt: "2026-10-01T00:00:01.000Z" });
});
it("forwards the verified session and original request identity and revalidates the owner page", async () => {
    expect(await saveServerSettings(input)).toMatchObject({ ok: true, updatedAt: "2026-10-01T00:00:01.000Z" });
    const { requestId, ...mutation } = input;
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith("verified-token", mutation, requestId);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/servers/${serverId}`);
});
it("rejects injected authority and unsupported fields before contacting the API", async () => {
    for (const value of [{ ...input, owner: "owner" }, { ...input, patch: { timezone: "UTC" } },
        { ...input, patch: { configuration: {} } }, { ...input, patch: { maintenanceSlot: "12:00-13:00" } },
        { ...input, patch: { displayName: "../../bad" } }, { ...input, patch: {} }]) {
        expect(await saveServerSettings(value)).toMatchObject({ ok: false, rejected: true });
    }
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects mismatched sessions and retains uncertain requests for safe retry", async () => {
    mocks.auth.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "other" }, access_token: "wrong-token" } } }) } });
    expect(await saveServerSettings(input)).toMatchObject({ ok: false, rejected: true });
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "Stale page"));
    expect(await saveServerSettings(input)).toMatchObject({ ok: false, rejected: true });
    mocks.save.mockRejectedValueOnce(new MyServersApiError("request_conflict", "Different intent"));
    expect(await saveServerSettings(input)).toMatchObject({ ok: false, rejected: true });
    mocks.save.mockRejectedValueOnce(new MyServersApiError("control_plane_unavailable", "Unknown outcome", true));
    expect(await saveServerSettings(input)).toMatchObject({ ok: false, rejected: false });
});

it("names the rejected field instead of describing every rule at once", async () => {
    for (const [patch, field, message] of [
        [{ displayName: "ab" }, "displayName", "Server names need at least 3 characters."],
        [{ displayName: "a".repeat(49) }, "displayName", "Server names can have at most 48 characters."],
        [{ displayName: "../../bad" }, "displayName", "Use only letters, numbers, spaces, periods, apostrophes and hyphens, and start and end with a letter or number."],
        [{ displayName: "   " }, "displayName", "Enter a server name."],
        [{ maintenanceSlot: "12:00-13:00" }, "maintenanceSlot", "Choose one of the listed maintenance windows."],
        [{ displayName: "Valid name", maintenanceSlot: "12:00-13:00" }, "maintenanceSlot", "Choose one of the listed maintenance windows."],
    ] as const) {
        expect(await saveServerSettings({ ...input, patch })).toEqual({ ok: false, rejected: true, field, message });
    }
    expect(await saveServerSettings({ ...input, serverId: "not-a-server" })).toEqual({ ok: false, rejected: true,
        message: "The settings request is invalid. Refresh the page and try again." });
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
