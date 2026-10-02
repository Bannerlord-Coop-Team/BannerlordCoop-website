import { expect, it, vi } from "vitest";
import LegacyLiveServerPage from "./page";

vi.mock("next/navigation", () => ({
    // Model Next's terminal redirect without resolving request state or server access.
    redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));

it.each(["live-server", "server /?#名", "abc%2Fdef"])("preserves the unified route redirect for %s", async (serverId) => {
    await expect(LegacyLiveServerPage({ params: Promise.resolve({ serverId }) }))
        .rejects.toThrow(`redirect:/servers/${encodeURIComponent(serverId)}`);
});
