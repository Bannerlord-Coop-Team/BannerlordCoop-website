import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { discordUserSummary, resolveDiscordUserReference, uniqueDiscordUsers } from "./discord-users";

function user(id: string, metadata: Record<string, unknown>): User {
    return { id, user_metadata: metadata, identities: [] } as unknown as User;
}

test("reads the unique Discord username and provider id from Supabase metadata", () => {
    assert.deepEqual(discordUserSummary(user("auth-1", {
        provider_id: "763278507085922325",
        full_name: "shot_up",
        name: "discord-user",
    })), {
        discordUserId: "763278507085922325",
        username: "shot_up",
    });
});

test("rejects non-Discord provider ids and deduplicates Discord accounts", () => {
    const users = uniqueDiscordUsers([
        user("auth-1", { provider_id: "763278507085922325", full_name: "shot_up" }),
        user("auth-2", { provider_id: "763278507085922325", full_name: "duplicate" }),
        user("auth-3", { provider_id: "google-subject", full_name: "not_discord" }),
    ]);

    assert.deepEqual(users, [{ discordUserId: "763278507085922325", username: "shot_up" }]);
});

test("resolves a unique Discord username or a numeric Discord user ID", () => {
    const users = [{ discordUserId: "763278507085922325", username: "shot_up" }];

    assert.equal(resolveDiscordUserReference("@SHOT_UP", users), "763278507085922325");
    assert.equal(resolveDiscordUserReference("763278507085922325", users), "763278507085922325");
    assert.equal(resolveDiscordUserReference("unknown", users), null);
});
