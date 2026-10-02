import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "ru",
    name: "Русский",
    enabled: false,
    openGraphLocale: "ru_RU",
    dictionaries: {

    },
};

export default definition;
