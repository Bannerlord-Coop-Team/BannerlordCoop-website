import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "ko",
    name: "한국어",
    enabled: false,
    openGraphLocale: "ko_KR",
    dictionaries: {

    },
};

export default definition;
