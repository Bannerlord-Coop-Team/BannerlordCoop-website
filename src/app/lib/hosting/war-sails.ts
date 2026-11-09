import type { Translator } from "@/app/lib/localization/types";
import type { MyServerSavePage } from "@/app/lib/control-plane/types";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";

// War Sails is a property of the campaign (its save), not a free setting: the control plane derives
// `modOptions.warSails` from the active save at Start and refuses launches it cannot run.

/** The official War Sails DLC module players enable, loaded right after Coop. The name stays English in every locale. */
export const WAR_SAILS_MODULE = { id: "NavalDLC", name: "War Sails" } as const;

/** Launch failures the control plane reports when a campaign's War Sails mode cannot run. */
export const WAR_SAILS_FAILURE_CODES = ["war_sails_save_mismatch", "war_sails_unsupported"] as const;
export type WarSailsFailureCode = (typeof WAR_SAILS_FAILURE_CODES)[number];

/** Whether a failure or refusal code is one of the War Sails launch failures. */
export function isWarSailsFailureCode(code: unknown): code is WarSailsFailureCode {
    return WAR_SAILS_FAILURE_CODES.includes(code as WarSailsFailureCode);
}

/** Returns the localized owner explanation for a War Sails launch failure. */
export function warSailsFailureMessage(code: WarSailsFailureCode, t: Translator["t"]): string {
    return t(code === "war_sails_unsupported" ? "controls.warSailsUnsupported" : "controls.warSailsSaveMismatch");
}

/** Whether the active campaign runs War Sails: its save label when known, otherwise the stored mod configuration. */
export function campaignUsesWarSails(files: OwnerFileStatus | null, saves: MyServerSavePage | null): boolean {
    const active = saves?.items.find(item => item.saveId === saves.activeSaveId);
    if (typeof active?.warSails === "boolean") return active.warSails;
    return files?.managedConfig.modConfig.modOptions.warSails === true;
}
