import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "pt-PT",
    name: "Português (Portugal)",
    enabled: false,
    openGraphLocale: "pt_PT",
    dictionaries: {

    },
};

export default definition;
