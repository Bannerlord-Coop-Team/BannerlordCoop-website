import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { readManagedServerConfig, readManagedServerConfigFiles, saveManagedServerConfig } from "./managed-server-config-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as config } from "../../../supabase/functions/_shared/managed-server-configuration";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/server-configuration", () => ({ getMyServerConfiguration: mocks.read, saveMyServerConfiguration: mocks.save }));
const id = "11111111-1111-4111-8111-111111111111";
const revision = "a".repeat(64);
const file = { configPart: "server", revision, settings: config.serverConfig };
const request = { requestId: id, serverId: id, configPart: "server", expectedRevision: revision, settings: config.serverConfig };
beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), getSession: async () => ({ data: { session: { access_token: "original-owner-token" } } }) } });
});
it("checks the current account before reading or saving configuration", async () => {
    expect((await readManagedServerConfig(id, "server", "previous-owner")).ok).toBe(false);
    expect((await saveManagedServerConfig(request, "previous-owner")).ok).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue(file);
    expect(await readManagedServerConfig(id, "server", "owner")).toEqual({ ok: true, file });
    expect(mocks.read).toHaveBeenCalledWith("original-owner-token", id, "server");
    expect((await readManagedServerConfig(id, "combined", "owner")).ok).toBe(false);
});
it("reads both configuration files concurrently in one authenticated action", async () => {
    const pending: ((value: unknown) => void)[] = [];
    mocks.read.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const result = readManagedServerConfigFiles(id, "owner");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(mocks.read.mock.calls).toEqual([["original-owner-token", id, "server"], ["original-owner-token", id, "mod"]]);
    pending[1](file);
    pending[0](file);
    expect(await result).toEqual({ server: { ok: true, file }, mod: { ok: true, file } });
    expect(mocks.auth).toHaveBeenCalledOnce();
});
it("reports each configuration file independently and checks the account before reading either", async () => {
    mocks.read.mockResolvedValueOnce(file).mockRejectedValueOnce(new MyServersApiError("agent_target_unavailable", "No runner"));
    const result = await readManagedServerConfigFiles(id, "owner");
    expect(result.server).toEqual({ ok: true, file });
    expect(result.mod).toMatchObject({ ok: false, message: expect.stringContaining("no active runner") });
    mocks.read.mockClear();
    expect(await readManagedServerConfigFiles(id, "previous-owner")).toMatchObject({ server: { ok: false }, mod: { ok: false } });
    expect(await readManagedServerConfigFiles("not-a-uuid", "owner")).toMatchObject({ server: { ok: false }, mod: { ok: false } });
    expect(mocks.read).not.toHaveBeenCalled();
});
it("re-validates settings and forwards the exact request identity, revision and file", async () => {
    mocks.save.mockResolvedValue(file);
    expect(await saveManagedServerConfig(request, "owner")).toEqual({ ok: true, file });
    expect(mocks.save).toHaveBeenCalledWith("original-owner-token", id, { serverId: id, configPart: "server", expectedRevision: revision, settings: config.serverConfig });
    mocks.save.mockClear();
    for (const invalid of [
        { ...request, settings: { ...config.serverConfig, password: "forbidden" } },
        { ...request, settings: { ...config.serverConfig, autosaveMinutes: 100_000 } },
        { ...request, expectedRevision: "stale" },
        { ...request, requestId: "not-a-uuid" },
        { ...request, configPart: "combined" },
        { ...request, path: "/etc/passwd" },
    ]) expect(await saveManagedServerConfig(invalid, "owner")).toMatchObject({ ok: false, notSubmitted: true });
    expect(mocks.save).not.toHaveBeenCalled();
});
it("maps conflicts to reload guidance and keeps unconfirmed failures retryable", async () => {
    mocks.save.mockRejectedValueOnce(new MyServersApiError("request_conflict", "Conflict"));
    expect(await saveManagedServerConfig(request, "owner")).toMatchObject({ ok: false, reload: true, notSubmitted: false });
    mocks.save.mockRejectedValueOnce(new MyServersApiError("server_not_found", "Missing"));
    expect(await saveManagedServerConfig(request, "owner")).toMatchObject({ ok: false, reload: false, message: expect.stringContaining("unavailable") });
    mocks.save.mockRejectedValueOnce(new Error("Lost connection"));
    expect(await saveManagedServerConfig(request, "owner")).toMatchObject({ ok: false, reload: false, notSubmitted: false, message: expect.stringContaining("could not be confirmed") });
    mocks.read.mockRejectedValueOnce(new MyServersApiError("agent_target_unavailable", "No runner"));
    expect(await readManagedServerConfig(id, "mod", "owner")).toMatchObject({ ok: false, message: expect.stringContaining("no active runner") });
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));

// Keeps upstream runner diagnostics distinct from connectivity errors for every new code.
it("explains runner-side failures surfaced by the control plane instead of blaming connectivity", async () => {
    for (const [code, fragment, reload] of [
        ["idempotency_conflict", "changed on the runner", true],
        ["not_found", "no configuration file", false],
        ["integrity_failed", "integrity check", false],
        ["route_unavailable", "older version", false],
        ["agent_transport_unavailable", "did not respond", false],
        ["configuration_response_invalid", "does not understand", false],
        ["agent_target_invalid", "assignment is out of date", false],
        ["storage_unavailable", "did not respond", false],
        ["internal_error", "did not respond", false],
        ["agent_request_invalid", "rejected this request", false],
        ["agent_correlation_invalid", "rejected this request", false],
        ["agent_request_failed", "rejected this request", false],
        ["request_rejected", "rejected this request", false],
        ["agent_response_invalid", "unreadable response", false],
        ["control_plane_failure", "unexpected error", false],
        ["runtime_unavailable", "not ready for runner operations", false],
    ] as const) {
        mocks.read.mockRejectedValueOnce(new MyServersApiError(code, "Runner failure"));
        const result = await readManagedServerConfig(id, "server", "owner");
        expect(result).toMatchObject({ ok: false, reload, message: expect.stringContaining(fragment) });
        expect(result.ok || result.message).not.toContain("could not be reached");
    }
});

// Distinguishes submitted revision conflicts from failures before any write was sent.
it.each([false, true])("preserves idempotency conflict submission semantics (notSubmitted=%s)", async (notSubmitted) => {
    const error = new MyServersApiError("idempotency_conflict", "Runner failure");
    if (notSubmitted) mocks.auth.mockRejectedValueOnce(error);
    else mocks.save.mockRejectedValueOnce(error);
    expect(await saveManagedServerConfig(request, "owner")).toMatchObject({
        ok: false, notSubmitted, reload: !notSubmitted,
        message: expect.stringContaining(notSubmitted ? "were not sent" : "changed on the runner"),
    });
    expect(mocks.save).toHaveBeenCalledTimes(notSubmitted ? 0 : 1);
});
