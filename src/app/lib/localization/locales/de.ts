import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "de",
    name: "Deutsch",
    enabled: false,
    openGraphLocale: "de_DE",
    dictionaries: {

    },
};

export default definition;
