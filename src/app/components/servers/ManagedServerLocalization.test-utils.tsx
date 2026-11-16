import type { ReactNode } from "react";
import { LocalizationProvider } from "@/app/lib/localization/client";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import managed from "@/app/lib/localization/dictionaries/en/managed-server.json";
import shared from "@/app/lib/localization/dictionaries/en/server-common.json";
import cheats from "@/app/lib/localization/dictionaries/en/cheats.json";
import servers from "@/app/lib/localization/dictionaries/en/servers.json";

export const serverTestMessages = { common, "managed-server": managed, "server-common": shared, cheats, servers };

/** Simulates the payload of one router.refresh(): fresh message objects whose managed dictionary changed. */
export function refreshedMessages(refresh: number) {
    const messages = structuredClone(serverTestMessages);
    return { ...messages, "managed-server": { ...messages["managed-server"], "test.refreshed": `Refresh ${refresh}` } };
}

// Gives standalone server UI tests the same namespace composition as the unified page.
export function TestLocalization({ children }: { children: ReactNode }) {
    return <LocalizationProvider locale="en" messages={serverTestMessages}>{children}</LocalizationProvider>;
}
