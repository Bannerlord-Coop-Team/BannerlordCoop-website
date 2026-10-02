import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { createTranslator, messageTokens } from "@/app/lib/localization/translator";
import type { Dictionary, Locale } from "@/app/lib/localization/types";
import messages from "@/app/lib/localization/dictionaries/en/live-server.json";
import { LiveServerAccessManager } from "./LiveServerAccessManager";
import { LiveServerBackupSetup } from "./LiveServerBackupSetup";
import { LiveServerFileSetup } from "./LiveServerFileSetup";
import { LiveServerVisibilitySetup } from "./LiveServerVisibilitySetup";
import { LiveServerOperationButtons } from "./LiveServerOperationButtons";
import { IonosManagementSection } from "./IonosManagementSection";

let dictionary: Dictionary = messages;
let locale: Locale = "en";
vi.mock("@/app/lib/localization/server", () => ({
    // Keep the actual translator while selecting request messages without Next request infrastructure.
    getTranslations: async () => createTranslator(locale, dictionary),
}));
vi.mock("@/app/servers/access-actions", () => ({
    addLiveConsoleOperator: vi.fn(), assignLiveConsoleOwner: vi.fn(), clearLiveConsoleOwner: vi.fn(), removeLiveConsoleOperator: vi.fn(),
}));
vi.mock("./ServerSaveConfigPanels", () => ({ ServerSaveConfigPanels: () => <div data-shared-files /> }));
vi.mock("./IonosServerButtons", () => ({ CreateIonosServerForm: () => null, DestroyIonosServerButton: () => null }));

beforeEach(() => { dictionary = messages; locale = "en"; });

it.each([
    ["backup", LiveServerBackupSetup], ["file", LiveServerFileSetup], ["visibility", LiveServerVisibilitySetup],
] as const)("localizes every %s setup state and preserves reload URLs", async (prefix, Component) => {
    for (const reason of ["lookup-failed", "mapping-required", "access-required"] as const) {
        dictionary = { ...messages, [`${prefix}.heading`]: "Título", [`${prefix}.lookupFailed`]: "Fallo de acceso", [`${prefix}.mappingRequired`]: "Sin enlace", [`${prefix}.accessRequired`]: "Sin acceso" };
        locale = "es";
        const html = renderToStaticMarkup(await Component({ reason, serverId: "server /名" }));
        expect(html).toContain("Título");
        expect(html).toContain(reason === "lookup-failed" ? "Fallo de acceso" : reason === "mapping-required" ? "Sin enlace" : "Sin acceso");
        if (reason === "lookup-failed") {
            expect(html).toContain(`/servers/${encodeURIComponent("server /名")}#server-${prefix === "backup" ? "backups" : prefix === "file" ? "files" : "visibility"}`);
            expect(html).toContain('role="alert"');
        } else expect(html).toContain('href="/servers"');
    }
});

it("localizes operator presentation and escapes real names without changing form field IDs", () => {
    const translated = { ...messages, "access.owner": "Propietario", "access.operators": "Operadores", "access.operatorEmail": "Correo del operador", "access.removeOperator": "Quitar operador: {name}", "access.removeTitle": "Quitar: {name}", "access.addOperator": "Añadir operador" };
    const html = renderToStaticMarkup(<LocalizationProvider locale="es" messages={{ "live-server": translated }}>
        <LiveServerAccessManager canAssignOwner={false} serverId="live" owner={{ id: "owner", displayName: "Owner name", email: "owner@example.test" }} operators={[{ id: "target", displayName: "<b>{name}</b>", email: "target@example.test" }]} />
    </LocalizationProvider>);
    expect(html).toContain("Propietario");
    expect(html).toContain("Operadores");
    expect(html).toContain("Quitar operador: &lt;b&gt;{name}&lt;/b&gt;");
    expect(html).toContain("Correo del operador");
    expect(html).toContain('id="operator-live"');
    expect(html).toContain('name="operatorUserId" value="target"');
    expect(html).toContain("target@example.test");
    expect(html).not.toContain("Assign owner");
});

// Preserve helper-injected missing labels and actual member values without text-based replacement.
it("renders injected member labels and real names matching English fallbacks unchanged", () => {
    const html = renderToStaticMarkup(<LocalizationProvider locale="es" messages={{ "live-server": messages }}>
        <LiveServerAccessManager canAssignOwner={false} serverId="live"
            owner={{ id: "owner", displayName: "Sin nombre", email: "Sin correo" }}
            operators={[{ id: "target", displayName: "Unnamed member", email: "No email" }]} />
    </LocalizationProvider>);
    for (const value of ["Sin nombre", "Sin correo", "Unnamed member", "No email"]) expect(html).toContain(value);
    expect(html).toContain('name="operatorUserId" value="target"');
});

it("localizes every operation label and accessible group while preserving disabled states", () => {
    const translated = { ...messages, "operation.group": "Operaciones", "operation.start.label": "Iniciar", "operation.stop.label": "Detener", "operation.restart.label": "Reiniciar", "operation.update.label": "Actualizar" };
    const html = renderToStaticMarkup(<LocalizationProvider locale="es" messages={{ "live-server": translated }}>
        <LiveServerOperationButtons controlsReady pendingOperation="restart" onOperation={() => undefined} />
    </LocalizationProvider>);
    expect(html).toContain('aria-label="Operaciones"');
    for (const label of ["Iniciar", "Detener", "Reiniciar", "Actualizar"]) expect(html).toContain(label);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(4);
});

it("formats IONOS inventory numbers and retains vendor states, names, IDs and addresses", async () => {
    locale = "es";
    dictionary = { ...messages, "ionos.heading": "Infraestructura IONOS", "ionos.manage": "Administrar", "ionos.unknown": "Desconocido" };
    const html = renderToStaticMarkup(await IonosManagementSection({
        creationEnabled: false, isAdmin: false, loadError: "", locations: [],
        provisioning: { imageAlias: "debian:12", location: "de/fra" },
        servers: [{ cores: 1234.5, datacenterId: "dc-id", id: "server-id", ips: ["203.0.113.1"], location: "de/fra", name: "<source-name>", preset: null, provisioningState: "AVAILABLE", ramMb: null, storageGb: null, type: "CUBE", vmState: "RUNNING" }],
    }));
    expect(html).toContain("Infraestructura IONOS");
    expect(html).toContain("Administrar");
    expect(html).toContain("1234,5 vCPU");
    expect(html).toContain("Desconocido");
    expect(html).toContain("RUNNING");
    expect(html).toContain("&lt;source-name&gt;");
    expect(html).toContain("203.0.113.1");
    expect(html).toContain("debian:12");
    expect(html).toContain('/servers/server-id?datacenterId=dc-id');
});

it("resolves every English message with exact named tokens and all operation/state messages", () => {
    const translator = createTranslator("en", messages);
    expect(messages["console.opening"]).toBe("Opening the secure console connection…");
    expect(messages["console.statusSummary"]).toBe("{status} · {state} · {message}");
    expect(messages["operation.start.requested"]).toBe("Start operation requested…");
    for (const [key, message] of Object.entries(messages)) {
        const params = Object.fromEntries(messageTokens(message).map(token => [token, `<${token}>`]));
        expect(translator.t(key, params)).not.toMatch(/\{[a-zA-Z][a-zA-Z0-9_]*\}/);
    }
    for (const operation of ["start", "stop", "restart", "update"]) {
        for (const phase of ["label", "completed", "failed", "requested", "notice", "progress"]) expect(translator.t(`operation.${operation}.${phase}`)).toBeTruthy();
        if (operation !== "start") expect(translator.t(`operation.${operation}.confirmation`)).toBeTruthy();
    }
    for (const state of ["unknown", "error", "running", "starting", "stopped", "stopping", "restarting", "updating"]) expect(translator.t(`console.state.${state}`)).toBeTruthy();
});
