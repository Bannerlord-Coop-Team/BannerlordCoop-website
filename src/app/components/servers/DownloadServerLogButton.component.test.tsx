import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DownloadServerLogButton } from "./DownloadServerLogButton";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/hosting/server-files", () => ({ downloadMyServerLog: download }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: "user" }, access_token: "token" } } }) } }) }));

const container = document.createElement("div");
const root = createRoot(container);
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("downloads the server file with its original name and shows API errors", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    download.mockResolvedValueOnce({ filename: "latest.log", blob: new Blob(["hi"]) });
    const createUrl = vi.fn(() => "blob:log");
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = vi.fn(); });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    await act(async () => root.render(<TestLocalization>{<DownloadServerLogButton serverId="server" userId="user" className="existing-server-button" />} </TestLocalization>));
    expect(container.firstElementChild?.tagName).toBe("BUTTON");
    expect(container.querySelector("button")!.className).toBe("existing-server-button");
    await act(async () => container.querySelector("button")!.click());
    expect(download).toHaveBeenCalledWith("token", "server", {
        notFound: serverTestMessages["managed-server"]["log.notFound"],
        tooLarge: serverTestMessages["managed-server"]["log.tooLarge"],
        unavailable: serverTestMessages["managed-server"]["log.unavailable"],
        incomplete: serverTestMessages["managed-server"]["log.incomplete"],
        invalid: serverTestMessages["managed-server"]["log.invalid"],
        endpoint: {
            notConfigured: serverTestMessages["managed-server"]["log.notConfigured"],
            invalidUrl: serverTestMessages["managed-server"]["log.invalidUrl"],
            invalidKey: serverTestMessages["managed-server"]["log.invalidKey"],
        },
    });
    expect(filename).toBe("latest.log");
    expect(createUrl.mock.calls).toHaveLength(1);
    download.mockRejectedValueOnce(new Error("No .log file was found."));
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("No .log file was found.");
    expect(container.querySelector("button")!.disabled).toBe(false);
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
