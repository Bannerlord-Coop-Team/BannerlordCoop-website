import type { GatewayDatabase } from "./database.ts";
import type { DiscordApi } from "./discord.ts";
import type { RandomBytes } from "./tokens.ts";

/** Everything a gateway route needs, built once at boot and injected so handlers stay free of platform globals. */
export type GatewayContext = {
    db: GatewayDatabase;
    discord: DiscordApi;
    /** Current time in whole epoch seconds, the unit every gateway timestamp column uses. */
    now: () => number;
    random: RandomBytes;
};
