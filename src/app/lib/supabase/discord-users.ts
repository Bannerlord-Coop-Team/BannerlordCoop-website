import type { User } from "@supabase/supabase-js";

const DISCORD_SNOWFLAKE = /^[1-9][0-9]{16,19}$/u;

export type DiscordUserSummary = {
    discordUserId: string;
    username: string | null;
    email: string | null;
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
        metadata.user_name,
        metadata.username,
        metadata.preferred_username,
        identityData.full_name,
        metadata.full_name,
        identityData.name,
        metadata.name,
    ]);
    const normalizedUsername = rawUsername?.endsWith("#0") ? rawUsername.slice(0, -2) : rawUsername;
    const username = normalizedUsername
        && normalizedUsername.length <= 80
        && !/[\p{Cc}\p{Cf}]/u.test(normalizedUsername)
        ? normalizedUsername
        : null;
    const normalizedEmail = user.email?.trim() ?? "";
    const email = normalizedEmail.length > 0
        && normalizedEmail.length <= 254
        && !/[\p{Cc}\p{Cf}]/u.test(normalizedEmail)
        ? normalizedEmail
        : null;
    if (username === null && email === null) return null;
    return { discordUserId, username, email };
}

export function uniqueDiscordUsers(users: readonly User[]): DiscordUserSummary[] {
    const byId = new Map<string, DiscordUserSummary>();
    for (const user of users) {
        const summary = discordUserSummary(user);
        if (summary === null) continue;
        const existing = byId.get(summary.discordUserId);
        byId.set(summary.discordUserId, {
            discordUserId: summary.discordUserId,
            username: existing?.username ?? summary.username,
            email: existing?.email ?? summary.email,
        });
    }
    return [...byId.values()].sort((left, right) => ownerLabel(left).localeCompare(ownerLabel(right)));
}

export function resolveDiscordUserReference(raw: string, users: readonly DiscordUserSummary[]) {
    if (DISCORD_SNOWFLAKE.test(raw)) return raw;
    const normalized = raw.replace(/^@/u, "").trim().toLocaleLowerCase("en-US");
    const matches = users.filter((user) => user.username?.toLocaleLowerCase("en-US") === normalized);
    return matches.length === 1 ? matches[0].discordUserId : null;
}

function ownerLabel(user: DiscordUserSummary) {
    return user.username ?? user.email ?? user.discordUserId;
}

function firstString(values: readonly unknown[]) {
    return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}
