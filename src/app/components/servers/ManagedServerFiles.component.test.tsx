import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerFiles } from "./ManagedServerFiles";
import { ServerManagementWorkspace } from "./ServerManagementWorkspace";
import type { MyServerSummary } from "@/app/lib/control-plane/types";

vi.mock("./ManagedServerTransfers", () => ({ ManagedServerTransfers: ({ canImportConfig }: { canImportConfig: boolean }) => <div id="transfers">Transfers: {canImportConfig ? "config owner" : "save manager"}</div> }));
vi.mock("./ManagedServerBackups", () => ({ ManagedServerBackups: () => <div id="backups">Backup controls</div> }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.history.replaceState(null, "", "/servers/test");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each(["owner", "manager", "admin", "support"] as const)("preserves %s file permissions while splitting backups from transfers", async accessRole => {
    const server = { serverId: "test", accessRole } as MyServerSummary;
    await act(async () => root.render(<ServerManagementWorkspace name="Server" summary="Running" notice="Live controls" initialSection="Backups">
        <ManagedServerFiles userId="user" server={server} files={null} backups={[]} status={null} />
    </ServerManagementWorkspace>));
    if (accessRole === "owner" || accessRole === "manager") {
        expect(container.querySelector("#backups")?.closest("[hidden]")).toBeNull();
        expect(container.querySelector("#transfers")?.closest("[hidden]")).not.toBeNull();
        await act(async () => [...container.querySelectorAll("nav button")].find(b => b.textContent === "Save & config")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        expect(container.querySelector("#transfers")?.closest("[hidden]")).toBeNull();
        expect(container.querySelector("#backups")?.closest("[hidden]")).not.toBeNull();
        expect(container.querySelector("#transfers")?.textContent).toContain(accessRole === "owner" ? "config owner" : "save manager");
    } else {
        expect(container.querySelector("#transfers, #backups")).toBeNull();
        expect(container.textContent).toContain("read-only");
        for (const control of container.querySelectorAll("#server-files button, #server-files textarea")) expect((control as HTMLButtonElement).disabled).toBe(true);
    }
});
