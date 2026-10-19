import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AllServersDirectory } from "./AllServersDirectory";
import { ServerDirectoryTable } from "./ServerDirectoryTable";
import { LocalizationProvider } from "@/app/lib/localization/client";
import servers from "@/app/lib/localization/dictionaries/en/servers.json";
import serverCommon from "@/app/lib/localization/dictionaries/en/server-common.json";

const entry = { id: "unchanged-id", name: "Online {region} Campaign", status: "Online" as const, connectionType: "Direct" as const, joinUrl: "bannerlordcoop://join/unchanged-id", connectionAddress: "192.0.2.1:7210", players: 1234, manageUrl: "/servers/unchanged-id" };
const dictionary = { ...servers, "search.label": "Find campaigns", "search.placeholder": "Campaign query", "search.clear": "Reset query", "search.shown": { one: "Visible: {countLabel}", other: "Visible: {countLabel}" }, "search.empty": "No matching campaigns", "table.direct": "Direkt", "table.status.Online": "Running label", "table.name": "Campaign label", "table.manage": "Manage label" };

it("formats table numbers and translates enum labels without touching user names, addresses or routes", () => {
    const html = renderToStaticMarkup(<LocalizationProvider locale="pt-BR" messages={{ servers: dictionary, "server-common": serverCommon }}><ServerDirectoryTable servers={[entry]} emptyMessage="unused" /></LocalizationProvider>);
    expect(html).toContain("Online {region} Campaign");
    expect(html).toContain("Running label");
    expect(html).toContain("Campaign label");
    expect(html).toContain("Direkt");
    expect(html).toContain("1.234");
    expect(html).toContain('href="/servers/unchanged-id"');
    expect(html).toContain("192.0.2.1:7210");
});

it("searches translated connection presentation and keeps localized empty, count and clear states accessible", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    /** Exercises the real input handler rather than changing directory state directly. */
    async function search(value: string) {
        const input = container.querySelector("input")!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }
    try {
        await act(async () => root.render(<LocalizationProvider locale="en" messages={{ servers: dictionary, "server-common": serverCommon }}><AllServersDirectory servers={[entry]} /></LocalizationProvider>));
        expect(container.querySelector("label")?.textContent).toBe("Find campaigns");
        expect(container.querySelector("input")?.placeholder).toBe("Campaign query");
        await search("Direkt");
        expect(container.textContent).toContain(entry.name);
        expect(container.textContent).toContain("Visible: 1");
        await search("no-such-campaign");
        expect(container.textContent).toContain("No matching campaigns");
        expect(container.textContent).toContain("Visible: 0");
        const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Reset query"]')!;
        await act(async () => clear.click());
        expect(container.querySelector("input")?.value).toBe("");
        expect(container.textContent).toContain(entry.name);
    } finally { await act(async () => root.unmount()); container.remove(); }
});
