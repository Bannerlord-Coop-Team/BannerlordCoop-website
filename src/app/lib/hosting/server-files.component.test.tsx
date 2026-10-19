import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMyServerLog, type ServerLogDownloadMessages } from "./server-files";

vi.mock("./my-servers", () => ({
    // Supplies an isolated endpoint; no real hosting requests are made.
    myServersEndpoint: () => ({ endpoint: new URL("https://hosting.invalid/my-servers"), publishableKey: "test-key" }),
    requestMyServersApi: vi.fn(),
}));

const messages: ServerLogDownloadMessages = {
    notFound: "localized missing", tooLarge: "localized size", unavailable: "localized unavailable",
    incomplete: "localized incomplete", invalid: "localized invalid",
};

afterEach(() => vi.unstubAllGlobals());

// Matrix: each response failure preserves its detailed default and accepts injected diagnostics.
describe("log download diagnostics", () => {
    it.each([
        ["log_not_found", "notFound", "No .log file was found in this server's logs directory."],
        ["log_too_large", "tooLarge", "The latest log exceeds the 100 MiB download limit."],
        ["other", "unavailable", "The log could not be downloaded. The server may be unavailable; try again."],
    ] as const)("localizes %s without using upstream prose", async (code, key, english) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { code, message: "upstream text" } }) }));
        await expect(downloadMyServerLog("token", "server-id")).rejects.toThrow(english);
        await expect(downloadMyServerLog("token", "server-id", messages)).rejects.toThrow(messages[key]);
    });

    it.each([
        ["invalid", "Invalid log download", "text/plain", 3],
        ["incomplete", "The log download was incomplete. Try again.", "application/octet-stream", 4],
    ] as const)("localizes %s while preserving transport checks", async (key, english, type, size) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": type, "content-length": "3", "content-disposition": 'attachment; filename="server.log"' }),
            blob: async () => ({ size }),
        }));
        await expect(downloadMyServerLog("token", "server-id")).rejects.toThrow(english);
        await expect(downloadMyServerLog("token", "server-id", messages)).rejects.toThrow(messages[key]);
    });

    it("preserves authenticated request and downloaded values", async () => {
        const blob = new Blob(["log"]);
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "application/octet-stream", "content-length": "3", "content-disposition": 'attachment; filename="user.log"' }),
            blob: async () => blob,
        });
        vi.stubGlobal("fetch", fetch);
        await expect(downloadMyServerLog("token", "server-id", messages)).resolves.toEqual({ filename: "user.log", blob });
        expect(fetch).toHaveBeenCalledWith(new URL("https://hosting.invalid/my-servers?resource=download-server-log&serverId=server-id"), {
            headers: { authorization: "Bearer token", apikey: "test-key", accept: "application/octet-stream" }, cache: "no-store",
        });
    });
});
