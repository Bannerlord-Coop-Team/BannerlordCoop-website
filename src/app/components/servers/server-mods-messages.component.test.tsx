import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "./ManagedServerLocalization.test-utils";
import { describeModIssue, modLoadFailureMessage, modsErrorMessage } from "./server-mods-messages";
import { ServerModsError, type ServerMod } from "@/app/lib/hosting/server-mods";
import { isModLoadFailure, type ModLoadFailure } from "@/app/lib/hosting/mod-load-failure";
import { isOwnerRuntimeInsight } from "@/app/lib/hosting/owner-runtime-insight";

const { t } = createTranslator("en", serverTestMessages["managed-server"]);

it.each(["en", "de", "es", "fr", "ja", "ko", "pt-BR", "pt-PT", "ru", "tr", "zh-CN"])("localizes retryable runner maintenance in %s", locale => {
    const messages = JSON.parse(readFileSync(`src/app/lib/localization/dictionaries/${locale}/managed-server.json`, "utf8"));
    const message = modsErrorMessage(new ServerModsError("server_updating", true), createTranslator(locale as "en", messages).t);
    expect(message).toBe(messages["action.serverUpdating"]);
    expect(message.length).toBeGreaterThan(10);
    if (locale === "en") expect(message).toBe("Your server is updating. Try again in a minute.");
});
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
    ["submodule-dll-unreadable:Native.Interop.dll", "DLL Native.Interop.dll couldn't be read as a .NET assembly"],
])("explains the installed-mod note %s", (issue, text) => {
    expect(describeModIssue(issue, t)).toContain(text);
    expect(describeModIssue(issue, t)).not.toContain("Note:");
});

it("explains the assembly-conflict and SubModule rejections", () => {
    expect(modsErrorMessage(new ServerModsError("upload_rejected", false, "Separatism", "mod_assembly_conflict"), t)).toContain("same name as one the server provides");
    expect(modsErrorMessage(new ServerModsError("upload_rejected", false, "Fae", "mod_submodule_invalid"), t)).toContain("names a SubModule class or DLL the mod doesn't contain");
});

it("blames a refused save on its runs-on change only when the control plane's issue says so", () => {
    const changed = [{ id: "Fae", runsOn: "server" } as ServerMod];
    const missing = "submodule-class-missing:Fae.SubModule";
    expect(modsErrorMessage(new ServerModsError("runner_unsupported"), t, changed)).toContain("doesn't support players-only mods yet");
    expect(modsErrorMessage(new ServerModsError("mod_order_invalid", false, "fae", missing), t, changed))
        .toBe("Fae can't run on the server. This mod names a SubModule class (Fae.SubModule) that its DLL doesn't contain, so its code can only run in players' games. Upload a fixed build to run it on the server.");
    expect(modsErrorMessage(new ServerModsError("mod_order_invalid", false, "Fae", "submodule-dll-unreadable:Fae.dll"), t, changed)).toContain("Fae can't run on the server. This mod's DLL Fae.dll couldn't be read");
    // The same save may also break a dependency order for the same mod; without the issue that is the reason shown.
    expect(modsErrorMessage(new ServerModsError("mod_order_invalid", false, "Fae"), t, changed)).toBe("This order breaks a load rule for Fae. Check that its dependencies are enabled and load before it.");
    expect(modsErrorMessage(new ServerModsError("mod_order_invalid", false, "Other", missing), t, changed)).toContain("load rule for Other");
    expect(modsErrorMessage(new ServerModsError("mod_order_invalid", false, "Fae", missing), t, [{ id: "Fae", runsOn: "players" } as ServerMod])).toContain("load rule for Fae");
    expect(modsErrorMessage(new ServerModsError("runner_unsupported"), t)).toBe("This server's host does not support custom mods yet.");
});
