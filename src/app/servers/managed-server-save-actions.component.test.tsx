import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { deleteManagedServerSave } from "./managed-server-save-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), locale: "en" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: { id: "owner" } } }),
    getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "token" } } }),
} }) }));
vi.mock("@/app/lib/hosting/my-servers", async (original) => ({
    ...await original<object>(), deleteMyServerSave: mocks.remove,
}));
vi.mock("@/app/lib/localization/server", () => ({ getTranslations: async () => {
    const dictionary = JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${mocks.locale}/managed-server.json`, "utf8"));
    return { t: (key: string) => dictionary[key] };
} }));
const id = "11111111-1111-4111-8111-111111111111";
const input = { serverId: id, saveId: id, requestId: id, expectedUpdatedAt: "2026-10-02T12:00:00.000Z", confirmationText: "Campaign" };
const locales = readdirSync("src/app/lib/localization/dictionaries");

beforeEach(() => { vi.clearAllMocks(); mocks.locale = "en"; });
it.each(locales)("shows the loaded-save refusal in %s and keeps unknown errors generic", async (locale) => {
    mocks.locale = locale;
    const dictionary = JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${locale}/managed-server.json`, "utf8"));
    expect(dictionary["campaigns.saveStillLoaded"]).toBeTypeOf("string");
    expect(dictionary["campaigns.saveStillLoaded"].length).toBeGreaterThan(20);
    mocks.remove.mockRejectedValueOnce(new MyServersApiError("save_still_loaded", "Upstream text must not be displayed"));
    expect(await deleteManagedServerSave(input, "owner")).toEqual({ ok: false, message: dictionary["campaigns.saveStillLoaded"] });
    mocks.remove.mockRejectedValueOnce(new MyServersApiError("future_error", "Private details"));
    expect(await deleteManagedServerSave(input, "owner")).toEqual({ ok: false, message: dictionary["campaigns.deleteFailed"] });
});
it("retains the queued result and forwards the exact deletion request", async () => {
    mocks.remove.mockResolvedValue({ action: "delete-save", jobId: id, outcome: "enqueued" });
    expect(await deleteManagedServerSave(input, "owner")).toMatchObject({ ok: true });
    const { requestId, ...deletion } = input;
    expect(mocks.remove).toHaveBeenCalledWith("token", deletion, requestId);
});
