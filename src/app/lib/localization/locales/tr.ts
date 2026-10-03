import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "tr",
    name: "Türkçe",
    enabled: true,
    openGraphLocale: "tr_TR",
    dictionaries: {
        "common": () => import("../dictionaries/tr/common.json"),
        "home": () => import("../dictionaries/tr/home.json"),
        "account": () => import("../dictionaries/tr/account.json"),
        "changelog": () => import("../dictionaries/tr/changelog.json"),
        "cheats": () => import("../dictionaries/tr/cheats.json"),
        "login": () => import("../dictionaries/tr/login.json"),
        "servers": () => import("../dictionaries/tr/servers.json"),
        "managed-server": () => import("../dictionaries/tr/managed-server.json"),
        "server-common": () => import("../dictionaries/tr/server-common.json"),
        "live-server": () => import("../dictionaries/tr/live-server.json"),
        "server-wireframe": () => import("../dictionaries/tr/server-wireframe.json"),
        "support": () => import("../dictionaries/tr/support.json"),
        "not-found": () => import("../dictionaries/tr/not-found.json"),
    },
};

export default definition;
