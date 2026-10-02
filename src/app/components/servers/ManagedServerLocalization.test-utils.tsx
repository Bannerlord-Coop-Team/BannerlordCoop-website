import type { ReactNode } from "react";
import { LocalizationProvider } from "@/app/lib/localization/client";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import managed from "@/app/lib/localization/dictionaries/en/managed-server.json";
import shared from "@/app/lib/localization/dictionaries/en/server-common.json";
import cheats from "@/app/lib/localization/dictionaries/en/cheats.json";
import live from "@/app/lib/localization/dictionaries/en/live-server.json";

export const serverTestMessages = { common, "managed-server": managed, "server-common": shared, cheats, "live-server": live };

// Gives standalone server UI tests the same namespace composition as the unified page.
export function TestLocalization({ children }: { children: ReactNode }) {
    return <LocalizationProvider locale="en" messages={serverTestMessages}>{children}</LocalizationProvider>;
}
