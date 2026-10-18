import "server-only";
import type { LocaleDefinition } from "../types";

// Activates Russian and loads only the requested translated namespaces.
const definition: LocaleDefinition = {
    locale: "ru",
    name: "Русский",
    enabled: true,
    openGraphLocale: "ru_RU",
    dictionaries: {
        "common": () => import("../dictionaries/ru/common.json"),
        "home": () => import("../dictionaries/ru/home.json"),
        "account": () => import("../dictionaries/ru/account.json"),
        "changelog": () => import("../dictionaries/ru/changelog.json"),
        "cheats": () => import("../dictionaries/ru/cheats.json"),
        "login": () => import("../dictionaries/ru/login.json"),
        "servers": () => import("../dictionaries/ru/servers.json"),
        "managed-server": () => import("../dictionaries/ru/managed-server.json"),
        "server-common": () => import("../dictionaries/ru/server-common.json"),
        "live-server": () => import("../dictionaries/ru/live-server.json"),
        "server-wireframe": () => import("../dictionaries/ru/server-wireframe.json"),
        "support": () => import("../dictionaries/ru/support.json"),
        "not-found": () => import("../dictionaries/ru/not-found.json"),
    },
};

export default definition;
