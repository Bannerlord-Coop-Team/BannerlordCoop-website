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
        const dialog = document.querySelector('[role="dialog"]')!;
        // Portaled to body so ancestor stacking contexts (e.g. the hero's `isolate`) cannot cover it.
        expect(container.contains(dialog)).toBe(false);
        expect(dialog.textContent).toContain(common["download.description"]);
        expect(dialog.textContent).toContain(common["download.installer.description"]);
        const links = [...dialog.querySelectorAll("a")];
        expect(links.map((link) => link.href)).toEqual([
            new URL("/download/mod", window.location.origin).href,
            new URL("/download/server", window.location.origin).href,
            new URL("/nightly", window.location.origin).href,
            "https://steamcommunity.com/sharedfiles/filedetails/?id=3770450698",
            "https://www.moddb.com/mods/bannerlord-coop",
        ]);
        // Direct downloads stay in this tab so the browser saves the archive instead of opening a blank one.
        expect(links.slice(0, 2).map((link) => [link.textContent, link.target])).toEqual([
            [`${common["download.direct.mod"]}${common["download.direct.modDetail"]}`, ""],
            [`${common["download.direct.server"]}${common["download.direct.serverDetail"]}`, ""],
        ]);
        const nexus = dialog.querySelector('[aria-disabled="true"]')!;
        expect(nexus.textContent).toContain(common["download.nexus.name"]);
        expect(nexus.textContent).toContain(common["download.unavailable"]);
        expect(nexus.textContent).toContain(common["download.nexus.unavailable"]);
        const close = dialog.querySelector("button")!;
        expect(close.getAttribute("aria-label")).toBe(common["download.close"]);
        expect(document.activeElement).toBe(close);
        await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    } finally { await act(async () => root.unmount()); container.remove(); }
});
