import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "zh-CN",
    name: "简体中文",
    enabled: false,
    openGraphLocale: "zh_CN",
    dictionaries: {

    },
};

export default definition;
