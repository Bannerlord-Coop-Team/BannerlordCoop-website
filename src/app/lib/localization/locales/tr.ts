import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "tr",
    name: "Türkçe",
    enabled: false,
    openGraphLocale: "tr_TR",
    dictionaries: {

    },
};

export default definition;
