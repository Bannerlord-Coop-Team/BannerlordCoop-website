import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "en",
    name: "English",
    enabled: true,
    openGraphLocale: "en_US",
    dictionaries: {
        "common": () => import("../dictionaries/en/common.json"),
        "home": () => import("../dictionaries/en/home.json"),
        "account": () => import("../dictionaries/en/account.json"),
        "changelog": () => import("../dictionaries/en/changelog.json"),
        "cheats": () => import("../dictionaries/en/cheats.json"),
        "login": () => import("../dictionaries/en/login.json"),
        "servers": () => import("../dictionaries/en/servers.json"),
        "managed-server": () => import("../dictionaries/en/managed-server.json"),
        "server-common": () => import("../dictionaries/en/server-common.json"),
        "live-server": () => import("../dictionaries/en/live-server.json"),
        "server-wireframe": () => import("../dictionaries/en/server-wireframe.json"),
        "support": () => import("../dictionaries/en/support.json"),
        "not-found": () => import("../dictionaries/en/not-found.json"),
    },
};

export default definition;
