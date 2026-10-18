import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "de",
    name: "Deutsch",
    enabled: true,
    openGraphLocale: "de_DE",
    dictionaries: {
        "common": () => import("../dictionaries/de/common.json"),
        "home": () => import("../dictionaries/de/home.json"),
        "account": () => import("../dictionaries/de/account.json"),
        "changelog": () => import("../dictionaries/de/changelog.json"),
        "cheats": () => import("../dictionaries/de/cheats.json"),
        "login": () => import("../dictionaries/de/login.json"),
        "servers": () => import("../dictionaries/de/servers.json"),
        "managed-server": () => import("../dictionaries/de/managed-server.json"),
        "server-common": () => import("../dictionaries/de/server-common.json"),
        "live-server": () => import("../dictionaries/de/live-server.json"),
        "server-wireframe": () => import("../dictionaries/de/server-wireframe.json"),
        "support": () => import("../dictionaries/de/support.json"),
        "not-found": () => import("../dictionaries/de/not-found.json"),
    },
};

export default definition;
