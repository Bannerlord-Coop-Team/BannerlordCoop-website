import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "pt-BR",
    name: "Português (Brasil)",
    enabled: false,
    openGraphLocale: "pt_BR",
    dictionaries: {

    },
};

export default definition;
