import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "fr",
    name: "Français",
    enabled: true,
    openGraphLocale: "fr_FR",
    dictionaries: {
        "common": () => import("../dictionaries/fr/common.json"),
        "home": () => import("../dictionaries/fr/home.json"),
        "account": () => import("../dictionaries/fr/account.json"),
        "changelog": () => import("../dictionaries/fr/changelog.json"),
        "cheats": () => import("../dictionaries/fr/cheats.json"),
        "login": () => import("../dictionaries/fr/login.json"),
        "servers": () => import("../dictionaries/fr/servers.json"),
        "managed-server": () => import("../dictionaries/fr/managed-server.json"),
        "server-common": () => import("../dictionaries/fr/server-common.json"),
        "live-server": () => import("../dictionaries/fr/live-server.json"),
        "server-wireframe": () => import("../dictionaries/fr/server-wireframe.json"),
        "support": () => import("../dictionaries/fr/support.json"),
        "not-found": () => import("../dictionaries/fr/not-found.json"),
    },
};

export default definition;
