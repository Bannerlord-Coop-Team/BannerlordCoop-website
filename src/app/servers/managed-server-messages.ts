import type { Translator } from "@/app/lib/localization/types";
import type { ConfigurationImportMessages } from "../../../supabase/functions/_shared/configuration-file-import";
import type { ManagedConfigurationMessages } from "../../../supabase/functions/_shared/managed-server-configuration";

// Supplies the pure configuration validator with request-independent presentation messages.
export function configurationMessages(t: Translator["t"]): ManagedConfigurationMessages {
    return {
        root: t("configuration.root"), version: t("configuration.version"), shape: t("configuration.shape"),
        boolean: t("configuration.boolean"), integer: t("configuration.integer"), number: t("configuration.number"), choice: t("configuration.choice"),
    };
}

// Supplies detailed import diagnostics without exposing ignored setting values or changing parsing.
export function configurationImportMessages(t: Translator["t"]): ConfigurationImportMessages {
    return {
        invalidImport: t("import.invalidImport"), noServerSettings: t("import.noServerSettings"), chooseFile: t("import.chooseFile"),
        noGameplaySettings: t("import.noGameplaySettings"), tooLarge: t("import.tooLarge"), unreadable: t("import.unreadable"),
        combinedBackup: t("import.combinedBackup"), olderBackup: t("import.olderBackup"), expectedMod: t("import.expectedMod"),
        expectedServer: t("import.expectedServer"), duplicateNames: t("import.duplicateNames"), unknownSettings: t("import.unknownSettings"),
        unsupportedValues: t("import.unsupportedValues"), invalidObject: t("import.invalidObject"), unsupportedSetting: t("import.unsupportedSetting"),
        configuration: configurationMessages(t),
    };
}
