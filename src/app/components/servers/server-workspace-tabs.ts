// Shared by the server page and the client workspace, so this module must stay free of client-only code.
export const SERVER_WORKSPACE_TAB_PARAMETER = "tab";

export const SERVER_WORKSPACE_TABS = {
    console: "Console",
    backups: "Backups",
    "save-config": "Save & config",
    settings: "Settings",
} as const;

export type ServerWorkspaceTab = keyof typeof SERVER_WORKSPACE_TABS;
export type ServerWorkspaceSection = (typeof SERVER_WORKSPACE_TABS)[ServerWorkspaceTab];

// Restores a remembered workspace section from its URL value, ignoring anything unknown.
export function serverWorkspaceSectionFromTab(value: unknown): ServerWorkspaceSection | undefined {
    return typeof value === "string" && Object.hasOwn(SERVER_WORKSPACE_TABS, value)
        ? SERVER_WORKSPACE_TABS[value as ServerWorkspaceTab]
        : undefined;
}

// Names the URL value that remembers a workspace section.
export function serverWorkspaceTab(section: ServerWorkspaceSection): ServerWorkspaceTab {
    return (Object.keys(SERVER_WORKSPACE_TABS) as ServerWorkspaceTab[])
        .find((tab) => SERVER_WORKSPACE_TABS[tab] === section)!;
}
