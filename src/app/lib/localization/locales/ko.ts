import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; disabled locales ship no dictionaries.
const definition: LocaleDefinition = {
    locale: "ko",
    name: "한국어",
    enabled: true,
    openGraphLocale: "ko_KR",
    dictionaries: {
        "common": () => import("../dictionaries/ko/common.json"),
        "home": () => import("../dictionaries/ko/home.json"),
        "account": () => import("../dictionaries/ko/account.json"),
        "changelog": () => import("../dictionaries/ko/changelog.json"),
        "cheats": () => import("../dictionaries/ko/cheats.json"),
        "login": () => import("../dictionaries/ko/login.json"),
        "servers": () => import("../dictionaries/ko/servers.json"),
        "managed-server": () => import("../dictionaries/ko/managed-server.json"),
        "server-common": () => import("../dictionaries/ko/server-common.json"),
        "live-server": () => import("../dictionaries/ko/live-server.json"),
        "server-wireframe": () => import("../dictionaries/ko/server-wireframe.json"),
        "support": () => import("../dictionaries/ko/support.json"),
        "not-found": () => import("../dictionaries/ko/not-found.json"),
    },
};

export default definition;
