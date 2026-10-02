import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "./ManagedServerLocalization.test-utils";
import { ServerConsoleWorkspace, ServerManagementWorkspace, ServerWorkspacePanel } from "./ServerManagementWorkspace";
import { ManagedServerConfigEditor } from "./ManagedServerConfigEditor";
import { ManagedServerBackups } from "./ManagedServerBackups";
import { ManagedServerPollingProvider } from "./ManagedServerPollingProvider";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { DEFAULT_MANAGED_SERVER_CONFIGURATION } from "../../../../supabase/functions/_shared/managed-server-configuration";
import { configurationImportMessages } from "@/app/servers/managed-server-messages";
import { readConfigurationFile } from "../../../../supabase/functions/_shared/configuration-file-import";
import catalog from "@/app/cheats/commands.json";
import { isPublishedCheat } from "@/app/cheats/debugOnly";

// Verifies localized section labels never become tab identifiers or alter supplied user values.
it("changes workspace presentation while retaining section state and literal names", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<LocalizationProvider locale="es" messages={{ ...serverTestMessages, "server-common": {
            ...serverTestMessages["server-common"], "section.console": "Consola", "section.settings": "Ajustes",
        } }}><ServerManagementWorkspace name="Real {server}" summary="External provider">
            <ServerWorkspacePanel section="Console"><input defaultValue="unchanged command" /></ServerWorkspacePanel>
            <ServerWorkspacePanel section="Settings"><p>Settings content</p></ServerWorkspacePanel>
        </ServerManagementWorkspace></LocalizationProvider>));
        const settings = [...container.querySelectorAll("button")].find(button => button.textContent === "Ajustes")!;
        await act(async () => settings.click());
        expect(container.textContent).toContain("Real {server}");
        expect(container.querySelector("input")!.value).toBe("unchanged command");
        expect(container.querySelector("input")!.closest("[hidden]")).not.toBeNull();
        expect(settings.getAttribute("aria-current")).toBe("page");
    } finally { await act(async () => root.unmount()); }
});

// Uses authoritative cheats messages for names, argument search and summaries without changing syntax.
it("reuses cheats translations in the command reference", () => {
    const command = catalog.commands.find(command => command.side !== "client" && isPublishedCheat(command))!;
    const html = renderToStaticMarkup(<LocalizationProvider locale="es" messages={{ ...serverTestMessages, cheats: {
        ...serverTestMessages.cheats, [`command.${command.command}.summary`]: "Descripción traducida",
    } }}><ServerConsoleWorkspace coopCommandsOnly onSelectCommand={() => {}}><p>Output</p></ServerConsoleWorkspace></LocalizationProvider>);
    expect(html).toContain("Descripción traducida");
    expect(html).toContain(command.command);
    expect(html).not.toContain(command.summary);
});

// Formats backup sizes and dates using the provider locale rather than the browser default.
it("formats backup dates and sizes in the selected locale", () => {
    const date = "2026-09-01T14:45:07.479Z";
    const html = renderToStaticMarkup(<LocalizationProvider locale="es" messages={serverTestMessages}>
        <ManagedServerPollingProvider><ManagedServerBackups userId="user" status={null}
            server={{ serverId: "server", displayName: "Real campaign", friendlyRegion: "Europe", operationState: "stopped", observedGameState: "stopped", releaseChannel: "stable", updatedAt: date, accessRole: "owner" }}
            backups={[{ backupId: "backup", backupType: "manual", byteSize: 1024, createdAt: date, retentionExpiresAt: date, restoreState: "available", restoredAt: null, canRestore: true }]} />
        </ManagedServerPollingProvider>
    </LocalizationProvider>);
    expect(html).toContain("1,0 KB");
    expect(html).toContain(createTranslator("es", serverTestMessages["managed-server"]).date(date, { dateStyle: "medium", timeStyle: "short" }));
});

// Keeps configuration values immutable while translating field, choice and detailed parser presentation.
it("translates configuration labels and injects detailed import diagnostics", () => {
    const dictionary = { ...serverTestMessages["managed-server"], "configuration.field.autosaveMinutes": "Intervalo de guardado",
        "configuration.option.VeryEasy": "Muy fácil", "import.expectedMod": "Seleccione el archivo de juego" };
    const html = renderToStaticMarkup(<LocalizationProvider locale="es" messages={{ "managed-server": dictionary }}>
        <ManagedServerConfigEditor configuration={DEFAULT_MANAGED_SERVER_CONFIGURATION} />
    </LocalizationProvider>);
    expect(html).toContain("Intervalo de guardado");
    expect(html).toContain("Muy fácil");
    expect(html).toContain('value="VeryEasy"');
    const translator = createTranslator("es", dictionary);
    expect(() => readConfigurationFile('{"difficulty":{}}', "server", configurationImportMessages(translator.t))).toThrow("Seleccione el archivo de juego");
});
