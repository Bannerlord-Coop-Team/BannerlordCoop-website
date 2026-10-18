import type { Translator } from "@/app/lib/localization/types";
import { normalizeOnboardingName } from "../../../supabase/functions/_shared/server-onboarding-contract";

export type ManagedServerNameProblem = "required" | "tooShort" | "tooLong" | "characters";

// Explains why the hosting contract would reject a managed server name; the contract stays authoritative.
export function managedServerNameProblem(value: unknown): ManagedServerNameProblem | null {
    if (normalizeOnboardingName(value) !== null) return null;
    if (typeof value !== "string") return "required";
    const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!name) return "required";
    if (value.length < 3 || name.length < 3) return "tooShort";
    if (value.length > 48 || name.length > 48) return "tooLong";
    return "characters";
}

// Presents a managed server-name problem with request-independent localized messages.
export function managedServerNameMessage(problem: ManagedServerNameProblem, t: Translator["t"]) {
    switch (problem) {
        case "required": return t("name.required");
        case "tooShort": return t("server-settings.serverNamesNeedAtLeast3Characters");
        case "tooLong": return t("server-settings.serverNamesCanHaveAtMost48Characters");
        case "characters": return t("server-settings.useOnlyLettersNumbersSpacesPeriodsApostrophesAndHyphens");
    }
}
