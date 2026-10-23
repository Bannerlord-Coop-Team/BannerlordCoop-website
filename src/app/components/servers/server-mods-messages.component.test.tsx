import { expect, it } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import { serverTestMessages } from "./ManagedServerLocalization.test-utils";
import { modLoadFailureMessage } from "./server-mods-messages";
import { isModLoadFailure, type ModLoadFailure } from "@/app/lib/hosting/mod-load-failure";
import { isOwnerRuntimeInsight } from "@/app/lib/hosting/owner-runtime-insight";

const { t } = createTranslator("en", serverTestMessages["managed-server"]);
const insight = { desiredState: "stopped", observedAt: null, allowedActions: ["start"], crashLoopDetected: false,
    failureCode: null, recommendedAction: null, failureMessage: null, recommendation: null, start: null };

it.each([
    [{ modId: "CoopSycn", reason: "missing-assembly", assembly: "0Harmony" }, ["CoopSycn", "Harmony (0Harmony.dll)", "Bannerlord.Harmony", "bin folder"]],
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
