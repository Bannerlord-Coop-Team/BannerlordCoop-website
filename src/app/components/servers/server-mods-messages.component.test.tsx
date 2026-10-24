import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "./ManagedServerLocalization.test-utils";
import { describeModIssue, modLoadFailureMessage, modsErrorMessage, runsOnSaveErrorMessage } from "./server-mods-messages";
import { ServerModsError, type ServerMod } from "@/app/lib/hosting/server-mods";
import { isModLoadFailure, type ModLoadFailure } from "@/app/lib/hosting/mod-load-failure";
import { isOwnerRuntimeInsight } from "@/app/lib/hosting/owner-runtime-insight";

const { t } = createTranslator("en", serverTestMessages["managed-server"]);
const insight = { desiredState: "stopped", observedAt: null, allowedActions: ["start"], crashLoopDetected: false,
    failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: null };

it.each([
    [{ modId: "CoopSycn", reason: "missing-assembly", assembly: "0Harmony" }, ["CoopSycn", "Harmony (0Harmony.dll)", "Bannerlord.Harmony", "hosting problem", "re-uploading", "will not fix it", "Contact support"]],
    [{ modId: "Other", reason: "missing-assembly", assembly: "Dependency" }, ["Other", "Dependency", "Upload the dependency"]],
    [{ modId: "Other", reason: "missing-dll" }, ["Other", "SubModule.xml", "complete mod", "bin folder"]],
    [{ modId: "Other", reason: "load-error" }, ["Other", "version compatible", "dependencies"]],
    [{ modId: "Other", reason: "future" }, ["A custom mod failed to load"]],
])("gives repair guidance or generic fallback for %j", (diagnosis, parts) => {
    const message = modLoadFailureMessage(diagnosis as ModLoadFailure, t);
    for (const part of parts) expect(message).toContain(part);
});

it("accepts legacy and diagnosed summaries but rejects malformed or unknown details", () => {
    expect(isOwnerRuntimeInsight(insight)).toBe(true);
    for (const reason of ["load-error", "missing-dll", "missing-assembly"] as const) {
        const modLoadFailure = { modId: "CoopSycn", reason, ...(reason === "missing-assembly" ? { assembly: "0Harmony" } : {}) };
        expect(isOwnerRuntimeInsight({ ...insight, modLoadFailure })).toBe(true);
    }
    for (const modLoadFailure of [null, { modId: "../private", reason: "load-error" }, { modId: "Other", reason: "unknown" },
        { modId: "Other", reason: "missing-assembly", assembly: "/secret/path" }, { modId: "Other", reason: "load-error", extra: "secret" }]) {
        expect(isModLoadFailure(modLoadFailure)).toBe(false);
        expect(isOwnerRuntimeInsight({ ...insight, modLoadFailure })).toBe(false);
    }
});

it.each(["en", "de", "es", "fr", "ja", "ko", "pt-BR", "pt-PT", "ru", "tr", "zh-CN"])("keeps the hosting diagnosis localized in %s", locale => {
    const messages = JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${locale}/managed-server.json`, "utf8"));
    const message = modLoadFailureMessage({ modId: "CoopSycn", reason: "missing-assembly", assembly: "0Harmony" }, createTranslator(locale as "en", messages).t);
    expect(message).toContain("CoopSycn");
    expect(message).toContain("0Harmony.dll");
    expect(message).toContain("Bannerlord.Harmony");
    expect(message).not.toContain("{modId}");
    expect(message).toBe(messages["controls.modLoadFailedHarmony"].replace("{modId}", "CoopSycn"));
});

it.each([
    ["no-server-submodule", "None of this mod's code runs on the server. If it should, upload it again."],
    ["no-render-tag-removed", "interface-only tags were removed"],
    ["headless-server-unsupported", "headless server"],
    ["dedicated-server-tag-removed", "dedicated-server tags were removed"],
    ["submodule-class-missing:FamilyAppearanceEditor.SubModule", "names a SubModule class (FamilyAppearanceEditor.SubModule) that its DLL doesn't contain"],
    ["submodule-dll-missing:Missing.dll", "names a DLL (Missing.dll) that isn't in the mod"],
])("explains the installed-mod note %s", (issue, text) => {
    expect(describeModIssue(issue, t)).toContain(text);
    expect(describeModIssue(issue, t)).not.toContain("Note:");
});

it("explains the assembly-conflict and SubModule rejections", () => {
    expect(modsErrorMessage(new ServerModsError("upload_rejected", false, "Separatism", "mod_assembly_conflict"), t)).toContain("same name as one the server provides");
    expect(modsErrorMessage(new ServerModsError("upload_rejected", false, "Fae", "mod_submodule_invalid"), t)).toContain("names a SubModule class or DLL the mod doesn't contain");
});

it("explains refused runs-on changes only when the save changed them", () => {
    const changed = [{ id: "Fae", runsOn: "server" } as ServerMod];
    expect(runsOnSaveErrorMessage(new ServerModsError("runner_unsupported"), changed, t)).toContain("doesn't support players-only mods yet");
    expect(runsOnSaveErrorMessage(new ServerModsError("mod_order_invalid", false, "fae"), changed, t)).toContain("Fae can't run on the server");
    expect(runsOnSaveErrorMessage(new ServerModsError("mod_order_invalid", false, "Other"), changed, t)).toBeNull();
    expect(runsOnSaveErrorMessage(new ServerModsError("mod_order_invalid", false, "Fae"), [{ id: "Fae", runsOn: "players" } as ServerMod], t)).toBeNull();
    expect(runsOnSaveErrorMessage(new ServerModsError("runner_unsupported"), [], t)).toBeNull();
});
