import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "ja",
    name: "日本語",
    enabled: false,
    openGraphLocale: "ja_JP",
    dictionaries: {

    },
};

export default definition;
