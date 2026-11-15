// The single owner of the nightly-access policy: Discord roles, the seat limit and session lifetimes.
// The values are part of the access contract; wire formats live in formats.ts. Dependency-free so Next.js can import it.

/** Seats each eligible member can sponsor. */
export const SPONSORED_ACCOUNT_LIMIT = 10;

export const DISCORD_GUILD_ID = "709516043332354119";
const SUPPORTER_ROLE_IDS = Object.freeze([
    "1532151760012050452", // Patreon supporter
    "1532744756151455834", // Boosty supporter
    "1533090199104524338", // Afdian supporter
]);
const STAFF_ROLE_IDS = Object.freeze([
    "730945590011232296", // Helper
    "711610715152056331", // Mod Developer
    "750401609045115114", // Trial Dev
    "709516608741048390", // Administrator
    "730631536122003548", // Community Manager
    "730631233524072588", // Project Lead
]);
const TESTER_ROLE_ID = "710222948375593010";
const NIGHTLY_ACCESS_ROLE_IDS = Object.freeze([
    ...SUPPORTER_ROLE_IDS,
    ...STAFF_ROLE_IDS,
    TESTER_ROLE_ID,
    "1551834978570997792", // Competition Winner; eligible but not advertised on the website.
]);

/** The qualifying roles as every nightly page spells them; Competition Winner is deliberately not advertised. */
export const QUALIFYING_ROLES_TEXT = "Staff, Tester, Patreon, Boosty, or Afdian";

export const DEVICE_SESSION_SECONDS = 10 * 60;
export const DEVICE_POLL_INTERVAL_SECONDS = 3;
export const DOWNLOAD_SESSION_SECONDS = 60 * 60;
export const SPONSOR_SESSION_SECONDS = 24 * 60 * 60;
export const OAUTH_STATE_SECONDS = 10 * 60;

/** Whether any of the given Discord role IDs grants nightly access. */
export function hasNightlyAccessRole(roleIds: readonly string[]): boolean {
    return roleIds.some((roleId) => NIGHTLY_ACCESS_ROLE_IDS.includes(roleId));
}

/** Whether a bot-fetched guild member (null when absent) currently qualifies to sponsor and install. */
export function isEligibleNightlySponsor(member: { roles?: unknown } | null): boolean {
    if (member === null || !Array.isArray(member.roles)) return false;
    return hasNightlyAccessRole(member.roles.filter((roleId): roleId is string => typeof roleId === "string"));
}
