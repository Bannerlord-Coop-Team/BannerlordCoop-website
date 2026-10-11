import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { submitManagedConsoleCommand, checkManagedConsoleCommand, acknowledgeManagedConsoleCommand } from "./managed-server-console-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const mocks = vi.hoisted(() => ({ userId: "owner", sessionUserId: "owner", submit: vi.fn(), check: vi.fn(), ack: vi.fn(), inventory: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: { id: mocks.userId } } }),
    getSession: async () => ({ data: { session: { user: { id: mocks.sessionUserId }, access_token: "token" } } }),
} }) }));
vi.mock("@/app/lib/hosting/server-console", () => ({ submitMyServerConsoleCommand: mocks.submit, getMyServerConsoleResult: mocks.check, acknowledgeMyServerConsoleResult: mocks.ack }));
vi.mock("@/app/lib/hosting/my-servers-server", () => ({ listAllMyServers: mocks.inventory }));
const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const input = { serverId, command: "coop.help", expectedUpdatedAt: "2026-09-20T12:00:00.000Z" };
const reference = { serverId, jobId, commandRequestId: requestId };
beforeEach(() => { vi.resetAllMocks(); mocks.userId = "owner"; mocks.sessionUserId = "owner"; });

it.each(["changed account", "mismatched session"])("blocks all console actions when authentication changes: %s", async (reason) => {
    if (reason === "changed account") mocks.userId = "other";
    else mocks.sessionUserId = "other";
    expect(await submitManagedConsoleCommand(input, requestId, "owner")).toMatchObject({ ok: false, notSubmitted: true });
    expect(await checkManagedConsoleCommand(reference, "owner")).toMatchObject({ ok: false });
    expect(await acknowledgeManagedConsoleCommand(reference, "owner")).toMatchObject({ ok: false });
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.ack).not.toHaveBeenCalled();
});

it("preserves the original request UUID and treats transport errors as uncertain rather than rejected", async () => {
    mocks.submit.mockRejectedValue(new MyServersApiError("server_api_unavailable", "Unavailable", true));
    const result = await submitManagedConsoleCommand(input, requestId, "owner");
    expect(result).toMatchObject({ ok: false, notSubmitted: false, uncertain: true, refresh: false,
        message: "We couldn’t confirm the command was delivered. If no output appears in the console in a few seconds, send it again." });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("token", requestId, input);
    expect(mocks.inventory).not.toHaveBeenCalled();
});

it.each([
    ["operation_unavailable", "The server isn’t running, so the command can’t be delivered. Send it again once the server is running.", false],
    ["request_conflict", "The server is busy with another command or its status just changed. Wait a moment, then send it again.", false],
    ["rate_limited", "Too many requests. Wait before checking again.", false],
])("explains a definitive %s rejection without pointing the owner to Discord", async (code, message, refresh) => {
    mocks.submit.mockRejectedValue(new MyServersApiError(code, "Private details"));
    const result = await submitManagedConsoleCommand(input, requestId, "owner");
    expect(result).toEqual({ ok: false, notSubmitted: false, uncertain: false, refresh, message });
    expect(JSON.stringify(result)).not.toContain("Discord");
});

it("rejects a malformed command before dispatch", async () => {
    expect(await submitManagedConsoleCommand({ ...input, command: "coop.help; stop" }, requestId, "owner")).toMatchObject({ ok: false, notSubmitted: true, uncertain: false, refresh: false });
    expect(mocks.submit).not.toHaveBeenCalled();
});

const current = { serverId, operationState: "running", observedGameState: "running", updatedAt: "2026-09-20T12:05:00.000Z" };
const stale = () => new MyServersApiError("stale_interaction", "Refresh the hosting view.");

it("recovers one confirmed stale rejection in the background with the same command and request UUID", async () => {
    mocks.submit.mockRejectedValueOnce(stale()).mockResolvedValueOnce({ outcome: "enqueued", jobId });
    mocks.inventory.mockResolvedValue([current]);
    expect(await submitManagedConsoleCommand(input, requestId, "owner")).toEqual({ ok: true, result: { outcome: "enqueued", jobId } });
    expect(mocks.inventory).toHaveBeenCalledExactlyOnceWith("token");
    expect(mocks.submit.mock.calls).toEqual([
        ["token", requestId, input],
        ["token", requestId, { ...input, expectedUpdatedAt: current.updatedAt }],
    ]);
});

it("bounds stale recovery to one retry and explains another confirmed rejection without refreshing", async () => {
    mocks.submit.mockRejectedValue(stale());
    mocks.inventory.mockResolvedValue([current]);
    expect(await submitManagedConsoleCommand(input, requestId, "owner")).toMatchObject({ ok: false, uncertain: false, refresh: false,
        message: "The server is busy with another command or its status just changed. Wait a moment, then send it again." });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.inventory).toHaveBeenCalledOnce();
});

it.each([
    [[], "unavailable"],
    [[{ ...current, serverId: jobId }], "unavailable"],
    [[{ ...current, operationState: "stopped", observedGameState: "stopped" }], "isn’t running"],
    [[{ ...current, updatedAt: input.expectedUpdatedAt }], "status just changed"],
])("does not retry when fresh inventory cannot supply a runnable new generation: %j", async (inventory, message) => {
    mocks.submit.mockRejectedValueOnce(stale());
    mocks.inventory.mockResolvedValue(inventory);
    const result = await submitManagedConsoleCommand(input, requestId, "owner");
    expect(result).toMatchObject({ ok: false, uncertain: false, refresh: false });
    if (!result.ok) expect(result.message).toContain(message);
    expect(mocks.submit).toHaveBeenCalledOnce();
});

it("rechecks the rendered account before retrying a stale command", async () => {
    mocks.submit.mockRejectedValueOnce(stale());
    mocks.inventory.mockImplementationOnce(async () => { mocks.userId = "other"; return [current]; });
    expect(await submitManagedConsoleCommand(input, requestId, "owner")).toMatchObject({ ok: false, notSubmitted: true, uncertain: false, refresh: false });
    expect(mocks.submit).toHaveBeenCalledOnce();
});

it("does not retry again after an uncertain recovery attempt", async () => {
    mocks.submit.mockRejectedValueOnce(stale()).mockRejectedValueOnce(new MyServersApiError("server_api_unavailable", "Unavailable", true));
    mocks.inventory.mockResolvedValue([current]);
    expect(await submitManagedConsoleCommand(input, requestId, "owner")).toMatchObject({ ok: false, notSubmitted: false, uncertain: true, refresh: false });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.inventory).toHaveBeenCalledOnce();
});

it("does not recover a stale error that also claims an accepted operation", async () => {
    mocks.submit.mockRejectedValueOnce(new MyServersApiError("stale_interaction", "Private details", false, jobId));
    expect(await submitManagedConsoleCommand(input, requestId, "owner")).toMatchObject({ ok: false, uncertain: true, refresh: false });
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.inventory).not.toHaveBeenCalled();
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
