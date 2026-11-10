import { expect, it } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import { campaignUsesWarSails, isWarSailsFailureCode, warSailsFailureMessage, WAR_SAILS_FAILURE_CODES } from "./war-sails";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION } from "../../../../supabase/functions/_shared/managed-server-configuration";
import type { MyServerSavePage } from "@/app/lib/control-plane/types";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";

const LOCALES = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "pt-PT", "ru", "tr", "zh-CN"] as const;
const NEW_KEYS = [
    "controls.warSailsSaveMismatch", "controls.warSailsUnsupported",
    "campaigns.mode.legend", "campaigns.mode.classic", "campaigns.mode.classicHelp", "campaigns.mode.warSails", "campaigns.mode.warSailsHelp",
    "campaigns.switchToWarSails", "campaigns.switchToClassic", "mods.playersNeed.warSails",
];
const saveId = "22222222-2222-4222-8222-222222222222";
const files = (warSails: boolean): OwnerFileStatus => ({ serverId: saveId, updatedAt: "2026-11-08T00:00:00.000Z", operationState: "stopped", observedGameState: "stopped", activeSave: null,
    managedConfig: { ...DEFAULT_MANAGED_SERVER_CONFIGURATION, modConfig: { ...DEFAULT_MANAGED_SERVER_CONFIGURATION.modConfig, modOptions: { ...DEFAULT_MANAGED_SERVER_CONFIGURATION.modConfig.modOptions, warSails } } } });
const saves = (warSails?: boolean | null): MyServerSavePage => ({ serverId: saveId, updatedAt: "2026-11-08T00:00:00.000Z", activeSaveId: saveId, nextCursor: null,
    items: [{ saveId, displayName: "Campaign", byteSize: 1, createdAt: "2026-11-08T00:00:00.000Z", lastUsedAt: null, importedBy: "system", ...(warSails === undefined ? {} : { warSails }) }] });

it("recognizes exactly the two shared War Sails launch failure codes", () => {
    expect(WAR_SAILS_FAILURE_CODES).toEqual(["war_sails_save_mismatch", "war_sails_unsupported"]);
    for (const code of WAR_SAILS_FAILURE_CODES) expect(isWarSailsFailureCode(code)).toBe(true);
    for (const code of ["mod_load_failed", "war_sails", "war-sails-unsupported", null, undefined]) expect(isWarSailsFailureCode(code)).toBe(false);
});

it("takes the active campaign's label first and falls back to the stored mod configuration", () => {
    expect(campaignUsesWarSails(files(false), saves(true))).toBe(true);
    expect(campaignUsesWarSails(files(true), saves(false))).toBe(false);
    expect(campaignUsesWarSails(files(true), saves(null))).toBe(true);
    expect(campaignUsesWarSails(files(true), saves())).toBe(true);
    expect(campaignUsesWarSails(files(false), saves())).toBe(false);
    expect(campaignUsesWarSails(null, saves(true))).toBe(true);
    expect(campaignUsesWarSails(null, null)).toBe(false);
});

it.each(LOCALES)("localizes every new War Sails string in %s, keeps the name in English, and drops the old toggle copy", async locale => {
    const dictionary = (await import(`@/app/lib/localization/dictionaries/${locale}/managed-server.json`)).default as Record<string, string>;
    for (const key of NEW_KEYS) expect(dictionary[key], key).toMatch(/\S/u);
    for (const key of NEW_KEYS.filter(key => key !== "campaigns.mode.legend" && key !== "campaigns.mode.classic")) {
        expect(dictionary[key], key).toContain("War Sails");
    }
    for (const key of ["configEditor.warSailsHelp", "configEditor.warSailsOn", "configEditor.warSailsOff"]) expect(dictionary[key], key).toBeUndefined();
    expect(dictionary["configuration.field.warSails"]).toBeUndefined();
    const t = createTranslator(locale, dictionary).t;
    expect(warSailsFailureMessage("war_sails_unsupported", t)).toBe(dictionary["controls.warSailsUnsupported"]);
    expect(warSailsFailureMessage("war_sails_save_mismatch", t)).toBe(dictionary["controls.warSailsSaveMismatch"]);
});
