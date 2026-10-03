import "server-only";
import type { LocaleDefinition } from "../types";

// This locale owns its activation and namespace loaders; all thirteen European Portuguese dictionaries are complete.
const definition: LocaleDefinition = {
    locale: "pt-PT",
    name: "Português (Portugal)",
    enabled: true,
    openGraphLocale: "pt_PT",
    dictionaries: {
        // Loads the common namespace only when requested.
        "common": () => import("../dictionaries/pt-PT/common.json"),
        // Loads the home namespace only when requested.
        "home": () => import("../dictionaries/pt-PT/home.json"),
        // Loads the account namespace only when requested.
        "account": () => import("../dictionaries/pt-PT/account.json"),
        // Loads the changelog namespace only when requested.
        "changelog": () => import("../dictionaries/pt-PT/changelog.json"),
        // Loads the cheats namespace only when requested.
        "cheats": () => import("../dictionaries/pt-PT/cheats.json"),
        // Loads the login namespace only when requested.
        "login": () => import("../dictionaries/pt-PT/login.json"),
        // Loads the servers namespace only when requested.
        "servers": () => import("../dictionaries/pt-PT/servers.json"),
        // Loads the managed-server namespace only when requested.
        "managed-server": () => import("../dictionaries/pt-PT/managed-server.json"),
        // Loads the server-common namespace only when requested.
        "server-common": () => import("../dictionaries/pt-PT/server-common.json"),
        // Loads the live-server namespace only when requested.
        "live-server": () => import("../dictionaries/pt-PT/live-server.json"),
        // Loads the server-wireframe namespace only when requested.
        "server-wireframe": () => import("../dictionaries/pt-PT/server-wireframe.json"),
        // Loads the support namespace only when requested.
        "support": () => import("../dictionaries/pt-PT/support.json"),
        // Loads the not-found namespace only when requested.
        "not-found": () => import("../dictionaries/pt-PT/not-found.json"),
    },
};

export default definition;
