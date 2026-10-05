import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { changeServerRelease } from "./server-release-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), release: vi.fn(), list: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({ ...await original<typeof import("@/app/lib/hosting/my-servers")>(), requestMyServerRelease: mocks.release }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({ listAllMyServers: mocks.list }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

const serverId = "11111111-1111-4111-8111-111111111111";
const jobId = "33333333-3333-4333-8333-333333333333";
const input = { serverId, releaseChannel: "nightly", expectedUpdatedAt: "2026-10-01T00:00:00.000Z", requestId: "22222222-2222-4222-8222-222222222222", previousChannel: "stable" };
const fresh = { serverId, accessRole: "owner", releaseChannel: "stable", updatedAt: "2026-10-01T00:00:09.000Z" };

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "verified-token" } } }) } });
    mocks.release.mockResolvedValue({ action: "update", jobId, outcome: "enqueued" });
    mocks.list.mockResolvedValue([fresh]);
});

it("queues the change once at the current revision when an unrelated write conflicts", async () => {
    mocks.release.mockRejectedValueOnce(new MyServersApiError("request_conflict", "Stale revision"));
    expect(await changeServerRelease(input)).toMatchObject({ ok: true, jobId });
    expect(mocks.release).toHaveBeenCalledTimes(2);
    const [, retried, retryId] = mocks.release.mock.calls[1];
    expect(retried).toMatchObject({ releaseChannel: "nightly", expectedUpdatedAt: fresh.updatedAt });
    expect(retryId).not.toBe(input.requestId);
});

it("does not queue a change when the channel moved elsewhere or is already selected", async () => {
    mocks.release.mockRejectedValue(new MyServersApiError("request_conflict", "Stale revision"));
    mocks.list.mockResolvedValueOnce([{ ...fresh, releaseChannel: "nightly" }]);
    expect(await changeServerRelease(input)).toMatchObject({ ok: false, rejected: true, message: "This channel is already selected." });
    expect(await changeServerRelease({ ...input, previousChannel: "nightly" })).toMatchObject({ ok: false });
    expect(mocks.release).toHaveBeenCalledTimes(2);
});

it("keeps the original contract without a shown channel", async () => {
    mocks.release.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "Stale revision"));
    const withoutPrevious = { serverId: input.serverId, releaseChannel: input.releaseChannel, expectedUpdatedAt: input.expectedUpdatedAt, requestId: input.requestId };
    expect(await changeServerRelease(withoutPrevious)).toMatchObject({ ok: false, rejected: true });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(await changeServerRelease({ ...input, owner: "owner" })).toMatchObject({ ok: false });
});
