import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { submitManagedConsoleCommand, checkManagedConsoleCommand, acknowledgeManagedConsoleCommand } from "./managed-server-console-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const mocks = vi.hoisted(() => ({ userId: "owner", sessionUserId: "owner", submit: vi.fn(), check: vi.fn(), ack: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: { id: mocks.userId } } }),
    getSession: async () => ({ data: { session: { user: { id: mocks.sessionUserId }, access_token: "token" } } }),
} }) }));
vi.mock("@/app/lib/hosting/server-console", () => ({ submitMyServerConsoleCommand: mocks.submit, getMyServerConsoleResult: mocks.check, acknowledgeMyServerConsoleResult: mocks.ack }));
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
    expect(await submitManagedConsoleCommand(input, requestId, "owner")).toMatchObject({ ok: false, notSubmitted: false });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("token", requestId, input);
});

it("rejects a malformed command before dispatch", async () => {
    expect(await submitManagedConsoleCommand({ ...input, command: "coop.help; stop" }, requestId, "owner")).toMatchObject({ ok: false, notSubmitted: true });
    expect(mocks.submit).not.toHaveBeenCalled();
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
