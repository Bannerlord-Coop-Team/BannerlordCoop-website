import type { User } from "@supabase/supabase-js";

const DISCORD_SNOWFLAKE = /^[1-9][0-9]{16,19}$/u;

export type DiscordUserSummary = {
    discordUserId: string;
    username: string;
};

export function discordUserSummary(user: User): DiscordUserSummary | null {
    const metadata = user.user_metadata as Record<string, unknown>;
    const identity = user.identities?.find((candidate) => candidate.provider === "discord");
    const identityData = (identity?.identity_data ?? {}) as Record<string, unknown>;
    const discordUserId = firstString([
        identityData.provider_id,
        identityData.sub,
        identityData.id,
        metadata.provider_id,
    ]);
    if (!discordUserId || !DISCORD_SNOWFLAKE.test(discordUserId)) return null;

    const rawUsername = firstString([
        identityData.user_name,
        identityData.username,
        identityData.preferred_username,
        identityData.name,
        metadata.user_name,
        metadata.username,
        metadata.name,
        identityData.full_name,
        metadata.full_name,
    ]);
    if (!rawUsername) return null;
    const username = rawUsername.endsWith("#0") ? rawUsername.slice(0, -2) : rawUsername;
    if (username.length < 1 || username.length > 80 || /[\p{Cc}\p{Cf}]/u.test(username)) return null;
    return { discordUserId, username };
}

export function uniqueDiscordUsers(users: readonly User[]): DiscordUserSummary[] {
    const byId = new Map<string, DiscordUserSummary>();
    for (const user of users) {
        const summary = discordUserSummary(user);
        if (summary !== null && !byId.has(summary.discordUserId)) byId.set(summary.discordUserId, summary);
    }
    return [...byId.values()].sort((left, right) => left.username.localeCompare(right.username));
}

export function resolveDiscordUserReference(raw: string, users: readonly DiscordUserSummary[]) {
    if (DISCORD_SNOWFLAKE.test(raw)) return raw;
    const normalized = raw.replace(/^@/u, "").trim().toLocaleLowerCase("en-US");
    const matches = users.filter((user) => user.username.toLocaleLowerCase("en-US") === normalized);
    return matches.length === 1 ? matches[0].discordUserId : null;
}

function firstString(values: readonly unknown[]) {
    return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}
