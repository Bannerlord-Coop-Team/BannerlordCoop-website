// Nightly-access policy shared by the gateway: Discord roles, seat limits, lifetimes and fixed URLs.
// Copied verbatim from nightly-gateway/src/core.ts; the values are part of the access contract.

export const DISCORD_GUILD_ID = "709516043332354119";
export const SUPPORTER_ROLE_IDS = Object.freeze([
    "1532151760012050452", // Patreon supporter
    "1532744756151455834", // Boosty supporter
    "1533090199104524338", // Afdian supporter
]);
export const STAFF_ROLE_IDS = Object.freeze([
    "730945590011232296", // Helper
    "711610715152056331", // Mod Developer
    "750401609045115114", // Trial Dev
    "709516608741048390", // Administrator
    "730631536122003548", // Community Manager
    "730631233524072588", // Project Lead
]);
export const TESTER_ROLE_ID = "710222948375593010";
export const NIGHTLY_ACCESS_ROLE_IDS = Object.freeze([
    ...SUPPORTER_ROLE_IDS,
    ...STAFF_ROLE_IDS,
    TESTER_ROLE_ID,
    "1551834978570997792", // Competition Winner; eligible but not advertised on the website.
]);

export const SPONSORED_ACCOUNT_LIMIT = 10;
export const DEVICE_SESSION_SECONDS = 10 * 60;
export const DEVICE_POLL_INTERVAL_SECONDS = 3;
export const DOWNLOAD_SESSION_SECONDS = 60 * 60;
export const SPONSOR_SESSION_SECONDS = 24 * 60 * 60;
export const OAUTH_STATE_SECONDS = 10 * 60;

export const DISCORD_OAUTH_SCOPES = "identify guilds.members.read";
export const DISCORD_REDIRECT_URI = "https://bannerlordcoop.com/nightly/callback";
export const DISCORD_USER_AGENT = "DiscordBot (https://bannerlordcoop.com, 1)";

const SNOWFLAKE = /^\d{17,20}$/;

/** Whether any of the given Discord role IDs grants nightly access. */
export function hasNightlyAccessRole(roleIds: readonly string[]): boolean {
    return roleIds.some((roleId) => NIGHTLY_ACCESS_ROLE_IDS.includes(roleId));
}

/** Whether a bot-fetched guild member (null when absent) currently qualifies to sponsor and install. */
export function isEligibleNightlySponsor(member: { roles?: unknown } | null): boolean {
    if (member === null || !Array.isArray(member.roles)) return false;
    return hasNightlyAccessRole(member.roles.filter((roleId): roleId is string => typeof roleId === "string"));
}

/** Whether a value is a Discord snowflake ID string. */
export function isDiscordSnowflake(value: unknown): value is string {
    return typeof value === "string" && SNOWFLAKE.test(value);
}
