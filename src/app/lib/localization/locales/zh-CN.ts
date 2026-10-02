import "server-only";
import type { LocaleDefinition } from "../types";

// Activates Simplified Chinese and lazily loads its page-owned dictionaries.
const definition: LocaleDefinition = {
    locale: "zh-CN",
    name: "简体中文",
    enabled: true,
    openGraphLocale: "zh_CN",
    dictionaries: {
        // Load only the Simplified Chinese namespaces requested by the current page.
        "common": () => import("../dictionaries/zh-CN/common.json"),
        "home": () => import("../dictionaries/zh-CN/home.json"),
        "account": () => import("../dictionaries/zh-CN/account.json"),
        "changelog": () => import("../dictionaries/zh-CN/changelog.json"),
        "cheats": () => import("../dictionaries/zh-CN/cheats.json"),
        "login": () => import("../dictionaries/zh-CN/login.json"),
        "servers": () => import("../dictionaries/zh-CN/servers.json"),
        "managed-server": () => import("../dictionaries/zh-CN/managed-server.json"),
        "server-common": () => import("../dictionaries/zh-CN/server-common.json"),
        "live-server": () => import("../dictionaries/zh-CN/live-server.json"),
        "server-wireframe": () => import("../dictionaries/zh-CN/server-wireframe.json"),
        "support": () => import("../dictionaries/zh-CN/support.json"),
        "not-found": () => import("../dictionaries/zh-CN/not-found.json"),
    },
};

export default definition;
