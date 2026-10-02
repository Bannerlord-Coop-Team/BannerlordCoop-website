import type { User } from "@supabase/supabase-js";

function firstName(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
}

/** Selects display metadata or the caller's fallback; never use these values for authorization. */
export function accountDisplayName(user: Pick<User, "user_metadata">, fallback: string = "Your account"): string {
    const metadata = user.user_metadata ?? {};
    return firstName(metadata.display_name, metadata.full_name, metadata.name, metadata.preferred_username, metadata.user_name) ?? fallback;
}

export function discordDisplayName(user: Pick<User, "identities">): string | null {
    const metadata = user.identities?.find(identity => identity.provider === "discord")?.identity_data;
    return firstName(metadata?.preferred_username, metadata?.user_name, metadata?.name, metadata?.full_name);
}
