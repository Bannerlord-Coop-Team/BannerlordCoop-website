import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "es",
    name: "Español",
    enabled: true,
    openGraphLocale: "es_ES",
    dictionaries: {
        "common": () => import("../dictionaries/es/common.json"),
        "home": () => import("../dictionaries/es/home.json"),
        "account": () => import("../dictionaries/es/account.json"),
        "changelog": () => import("../dictionaries/es/changelog.json"),
        "cheats": () => import("../dictionaries/es/cheats.json"),
        "login": () => import("../dictionaries/es/login.json"),
        "servers": () => import("../dictionaries/es/servers.json"),
        "managed-server": () => import("../dictionaries/es/managed-server.json"),
        "server-common": () => import("../dictionaries/es/server-common.json"),
        "live-server": () => import("../dictionaries/es/live-server.json"),
        "server-wireframe": () => import("../dictionaries/es/server-wireframe.json"),
        "support": () => import("../dictionaries/es/support.json"),
        "not-found": () => import("../dictionaries/es/not-found.json"),
    },
};

export default definition;
