import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "pt-BR",
    name: "Português (Brasil)",
    enabled: true,
    openGraphLocale: "pt_BR",
    dictionaries: {
        "common": () => import("../dictionaries/pt-BR/common.json"),
        "home": () => import("../dictionaries/pt-BR/home.json"),
        "account": () => import("../dictionaries/pt-BR/account.json"),
        "changelog": () => import("../dictionaries/pt-BR/changelog.json"),
        "cheats": () => import("../dictionaries/pt-BR/cheats.json"),
        "login": () => import("../dictionaries/pt-BR/login.json"),
        "servers": () => import("../dictionaries/pt-BR/servers.json"),
        "managed-server": () => import("../dictionaries/pt-BR/managed-server.json"),
        "server-common": () => import("../dictionaries/pt-BR/server-common.json"),
        "live-server": () => import("../dictionaries/pt-BR/live-server.json"),
        "server-wireframe": () => import("../dictionaries/pt-BR/server-wireframe.json"),
        "support": () => import("../dictionaries/pt-BR/support.json"),
        "not-found": () => import("../dictionaries/pt-BR/not-found.json"),
    },
};

export default definition;
