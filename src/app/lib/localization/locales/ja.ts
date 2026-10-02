import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "ja",
    name: "日本語",
    enabled: true,
    openGraphLocale: "ja_JP",
    dictionaries: {
        "account": () => import("../dictionaries/ja/account.json"),
        "changelog": () => import("../dictionaries/ja/changelog.json"),
        "cheats": () => import("../dictionaries/ja/cheats.json"),
        "common": () => import("../dictionaries/ja/common.json"),
        "home": () => import("../dictionaries/ja/home.json"),
        "live-server": () => import("../dictionaries/ja/live-server.json"),
        "login": () => import("../dictionaries/ja/login.json"),
        "managed-server": () => import("../dictionaries/ja/managed-server.json"),
        "not-found": () => import("../dictionaries/ja/not-found.json"),
        "server-common": () => import("../dictionaries/ja/server-common.json"),
        "server-wireframe": () => import("../dictionaries/ja/server-wireframe.json"),
        "servers": () => import("../dictionaries/ja/servers.json"),
        "support": () => import("../dictionaries/ja/support.json"),
    },
};

export default definition;
