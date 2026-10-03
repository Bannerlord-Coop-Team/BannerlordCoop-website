import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "fr",
    name: "Français",
    enabled: false,
    openGraphLocale: "fr_FR",
    dictionaries: {

    },
};

export default definition;
