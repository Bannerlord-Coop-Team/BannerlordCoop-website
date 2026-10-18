import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { dismissManagedServerNotice } from "./server-notice-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({ ...await original<typeof import("@/app/lib/hosting/my-servers")>(), dismissServerNotice: mocks.dismiss }));
// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

const messages = serverTestMessages["managed-server"];
const serverId = "11111111-1111-4111-8111-111111111111";
const noticeId = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "verified-token" } } }) } });
    mocks.dismiss.mockResolvedValue({ dismissed: true });
});

it("dismisses the notice with the verified session and a fresh request ID", async () => {
    expect(await dismissManagedServerNotice({ serverId, noticeId })).toEqual({ ok: true });
    expect(mocks.dismiss).toHaveBeenCalledOnce();
    const [token, input, requestId] = mocks.dismiss.mock.calls[0]!;
    expect(token).toBe("verified-token");
    expect(input).toEqual({ serverId, noticeId });
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

it("explains that an impersonated session cannot dismiss", async () => {
    mocks.dismiss.mockRejectedValueOnce(new MyServersApiError("impersonation_read_only", "An impersonated session cannot dismiss notices."));
    expect(await dismissManagedServerNotice({ serverId, noticeId })).toEqual({ ok: false, message: messages["notices.dismissReadOnly"] });
});

it("hides a notice the server no longer has, and asks for a retry on other failures", async () => {
    mocks.dismiss.mockRejectedValueOnce(new MyServersApiError("notice_not_found", "The notice does not exist."));
    expect(await dismissManagedServerNotice({ serverId, noticeId })).toEqual({ ok: true });
    for (const error of [new MyServersApiError("server_api_unavailable", "Unreachable", true), new Error("boom")]) {
        mocks.dismiss.mockRejectedValueOnce(error);
        expect(await dismissManagedServerNotice({ serverId, noticeId })).toEqual({ ok: false, message: messages["notices.dismissFailed"] });
    }
});

it("asks for a fresh sign-in and rejects malformed input before contacting the API", async () => {
    mocks.auth.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) } });
    expect(await dismissManagedServerNotice({ serverId, noticeId })).toEqual({ ok: false, message: messages["notices.signInAgain"] });
    for (const value of [null, { serverId }, { serverId, noticeId: "notice" }, { serverId: "server", noticeId }, { serverId, noticeId, viewer: "admin" }]) {
        expect(await dismissManagedServerNotice(value)).toEqual({ ok: false, message: messages["notices.dismissFailed"] });
    }
    expect(mocks.dismiss).not.toHaveBeenCalled();
});
