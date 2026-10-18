import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { LocalizationProvider } from "@/app/lib/localization/client";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import { DownloadModal } from "./DownloadModal";

it("uses only common messages outside home and preserves download links and dialog keyboard behavior", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<LocalizationProvider locale="en" messages={{ common }}><DownloadModal trigger="navbar" /></LocalizationProvider>));
        const trigger = container.querySelector("button")!;
        expect(trigger.textContent).toContain("Download");
        await act(async () => trigger.click());
        const dialog = container.querySelector('[role="dialog"]')!;
        expect(dialog.textContent).toContain(common["download.description"]);
        expect(dialog.textContent).toContain(common["download.installer.description"]);
        expect([...dialog.querySelectorAll("a")].map((link) => link.href)).toEqual([
            "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/",
            "https://steamcommunity.com/sharedfiles/filedetails/?id=3770450698",
            "https://www.nexusmods.com/mountandblade2bannerlord/mods/2387",
            "https://www.moddb.com/mods/bannerlord-coop",
        ]);
        const close = dialog.querySelector("button")!;
        expect(close.getAttribute("aria-label")).toBe(common["download.close"]);
        expect(document.activeElement).toBe(close);
        await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    } finally { await act(async () => root.unmount()); container.remove(); }
});
