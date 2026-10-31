import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { changeServerBuild, readServerBuildOptions, readServerBuildStatus } from "./server-build-actions";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), change: vi.fn(), options: vi.fn(), status: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async original => ({
    ...await original<typeof import("@/app/lib/hosting/my-servers")>(),
    requestMyServerBuildChange: mocks.change, getMyServerBuildOptions: mocks.options, getMyServerBuildStatus: mocks.status,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

const serverId = "11111111-1111-4111-8111-111111111111";
const jobId = "33333333-3333-4333-8333-333333333333";
const input = { serverId, buildId: "v0.1.9", expectedUpdatedAt: "2026-10-01T00:00:00.000Z", acknowledgeSaveRisk: true, requestId: "22222222-2222-4222-8222-222222222222" };

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "verified-token" } } }) } });
    mocks.change.mockResolvedValue({ action: "update", jobId, outcome: "enqueued" });
});

it("submits the verified owner's choice with the caller's request identity and revalidates the page", async () => {
    expect(await changeServerBuild(input)).toEqual({ ok: true, outcome: "enqueued", jobId, message: "Version change queued. Follow its progress below." });
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith("verified-token",
        { action: "set-server-build", serverId, buildId: "v0.1.9", expectedUpdatedAt: input.expectedUpdatedAt, acknowledgeSaveRisk: true }, input.requestId);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/servers/${serverId}`);
});

it("reports a pin-only change and a return to Latest without a job", async () => {
    mocks.change.mockResolvedValueOnce({ action: "update", jobId: null, outcome: "pinned" });
    expect(await changeServerBuild(input)).toMatchObject({ ok: true, outcome: "pinned", jobId: null, message: "v0.1.9 is now selected. Automatic updates are paused until you select Latest." });
    mocks.change.mockResolvedValueOnce({ action: "update", jobId: null, outcome: "unpinned" });
    expect(await changeServerBuild({ ...input, buildId: null })).toMatchObject({ ok: true, outcome: "unpinned", message: "Automatic updates are on again for future releases." });
});

it("refuses malformed input before any request, and requires the exact closed shape", async () => {
    for (const bad of [{ ...input, buildId: "latest" }, { ...input, requestId: "nope" }, { ...input, acknowledgeSaveRisk: "yes" }, { ...input, owner: "x" },
        { serverId, buildId: null, expectedUpdatedAt: input.expectedUpdatedAt, requestId: input.requestId }, null, "text"]) {
        expect(await changeServerBuild(bad)).toMatchObject({ ok: false, rejected: true, message: "Choose one of the listed public versions." });
    }
    expect(mocks.change).not.toHaveBeenCalled();
});

it.each([
    ["stale_interaction", "The server changed. Refresh the page and choose the version again."],
    ["save_risk_unacknowledged", "Confirm that you understand the risk to your campaign first."],
    ["release_compatibility_unsafe", "That version cannot safely read your campaign, so it is not available."],
    ["validated_build_unavailable", "That version is no longer available. Refresh the page and choose another."],
    ["operation_in_progress", "Another server operation is running. Try again when it finishes."],
    ["no_update_available", "This server already follows the latest public version."],
    ["operation_unavailable", "Version changes are not available for this server right now. Try again later or contact hosting support."],
    ["native_game_maintenance_unsupported", "Version changes are not available for this server right now. Try again later or contact hosting support."],
    ["game_maintenance_state_unknown", "Version changes are not available for this server right now. Try again later or contact hosting support."],
])("explains the %s refusal in plain language and marks it rejected", async (code, message) => {
    mocks.change.mockRejectedValueOnce(new MyServersApiError(code, "raw upstream text"));
    expect(await changeServerBuild(input)).toEqual({ ok: false, rejected: true, message });
});

it("keeps an unconfirmed outcome retryable under the same request", async () => {
    mocks.change.mockRejectedValueOnce(new MyServersApiError("server_api_unavailable", "The managed-server API could not be reached.", true));
    expect(await changeServerBuild(input)).toEqual({ ok: false, rejected: false, message: "The version change could not be confirmed. Check its progress or try again." });
});

it("reads options and status for the verified session, and hides every failure", async () => {
    mocks.options.mockResolvedValueOnce({ serverId, selectable: true });
    mocks.status.mockResolvedValueOnce({ serverId, job: null });
    expect(await readServerBuildOptions(serverId)).toEqual({ serverId, selectable: true });
    expect(await readServerBuildStatus(serverId)).toEqual({ serverId, job: null });
    expect(mocks.options).toHaveBeenCalledWith("verified-token", serverId);
    mocks.options.mockRejectedValueOnce(new MyServersApiError("operation_unavailable", "Older control plane"));
    mocks.status.mockRejectedValueOnce(new Error("offline"));
    expect(await readServerBuildOptions(serverId)).toBeNull();
    expect(await readServerBuildStatus(serverId)).toBeNull();
    mocks.auth.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) } });
    expect(await readServerBuildOptions(serverId)).toBeNull();
});
