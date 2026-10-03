import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "es",
    name: "Español",
    enabled: false,
    openGraphLocale: "es_ES",
    dictionaries: {

    },
};

export default definition;
