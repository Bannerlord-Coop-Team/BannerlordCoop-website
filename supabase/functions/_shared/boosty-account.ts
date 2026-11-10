// Authenticated website-account operations for Boosty linking: status, issuing a DM code, and
// unlink. No Boosty user id leaves this boundary; the browser sees only link state and code timing.
import { exact, record, timestamp } from "./membership.ts";
import { parseFundingSnapshot } from "./funding-provider.ts";
import { generateLinkCode, LINK_CODE, linkCodeHash } from "./boosty-link-code.ts";
import type { membershipStore } from "./membership-store.ts";
import type { BoostyPolicy } from "./boosty-policy.ts";
import type { FundingAccountSurface } from "./funding-account.ts";

type Store = ReturnType<typeof membershipStore>;
type User = { accountId: string; discordUserId: string | null };
export type BoostyLinkStatus =
    | { version: 1; configured: false }
    | { version: 1; configured: true; creatorName: string; linked: boolean; linkState: string; verification: string; verifiedAt: string | null;
        pending: { expiresAt: string; matches: boolean } | null; outcome: "conflict" | "superseded" | null };

/** Projects the status RPC reply into the public shape, refusing any other account or shape. */
export function boostyLinkStatus(value: unknown, user: User, policy: BoostyPolicy): BoostyLinkStatus {
    if (!record(value) || !exact(value, ["snapshot", "pending", "outcome"])) throw new Error("Invalid Boosty status");
    const snapshot = parseFundingSnapshot(value.snapshot, user.accountId, "boosty");
    const pending = value.pending;
    if (pending !== null && (!record(pending) || !exact(pending, ["expiresAt", "matches"]) || !timestamp(pending.expiresAt) || typeof pending.matches !== "boolean")) throw new Error("Invalid Boosty status");
    if (value.outcome !== null && value.outcome !== "conflict" && value.outcome !== "superseded") throw new Error("Invalid Boosty status");
    return { version: 1, configured: true, creatorName: policy.creatorName, linked: snapshot.linkState === "linked", linkState: snapshot.linkState, verification: snapshot.verification,
        verifiedAt: snapshot.verifiedAt, pending: pending as { expiresAt: string; matches: boolean } | null, outcome: value.outcome };
}

/** Boosty's account-surface entry: status (with an optional shown code), issuing a DM code, and unlink. */
export function boostyAccountSurface(store: Store, user: User, policy: BoostyPolicy | null, respond: (body: unknown, status?: number) => Response): FundingAccountSurface {
    return { operations: {
        status: async body => {
            if (!exact(body, ["operation"]) && !(exact(body, ["operation", "code"]) && typeof body.code === "string" && LINK_CODE.test(body.code))) return null;
            if (policy === null) return respond({ version: 1, configured: false });
            const codeHash = typeof body.code === "string" ? await linkCodeHash(body.code) : null;
            return respond(boostyLinkStatus(await store.rpc("boosty_link_status", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId, p_code_hash: codeHash }), user, policy));
        },
        start: async body => {
            if (!exact(body, ["operation"])) return null;
            if (policy === null) return respond({ error: "not_configured" }, 409);
            const code = generateLinkCode();
            const started = await store.rpc("boosty_link_begin", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId, p_code_hash: await linkCodeHash(code) });
            if (!record(started) || !exact(started, ["expiresAt"]) || !timestamp(started.expiresAt)) throw new Error("Invalid Boosty code");
            return respond({ code, expiresAt: started.expiresAt });
        },
        unlink: async body => {
            if (!exact(body, ["operation"])) return null;
            await store.rpc("boosty_unlink", { p_account_id: user.accountId, p_discord_user_id: user.discordUserId });
            return respond({ unlinked: true });
        },
    } };
}

/** Strictly validates the Edge's public Boosty status reply for the website server. */
export function parseBoostyLinkStatus(value: unknown): BoostyLinkStatus {
    if (!record(value) || value.version !== 1 || typeof value.configured !== "boolean") throw new Error("Invalid Boosty status");
    if (!value.configured) { if (!exact(value, ["version", "configured"])) throw new Error("Invalid Boosty status"); return { version: 1, configured: false }; }
    const keys = ["version", "configured", "creatorName", "linked", "linkState", "verification", "verifiedAt", "pending", "outcome"];
    const pending = value.pending;
    if (!exact(value, keys) || typeof value.creatorName !== "string" || value.creatorName.length < 1 || value.creatorName.length > 64 || typeof value.linked !== "boolean"
        || !["linked", "unlinked", "identity_changed", "account_deleted"].includes(value.linkState as string)
        || !["qualifying", "nonqualifying", "unknown", "review_required", "unverified"].includes(value.verification as string)
        || !(value.verifiedAt === null || timestamp(value.verifiedAt)) || !(value.outcome === null || value.outcome === "conflict" || value.outcome === "superseded")
        || !(pending === null || (record(pending) && exact(pending, ["expiresAt", "matches"]) && timestamp(pending.expiresAt) && typeof pending.matches === "boolean"))) throw new Error("Invalid Boosty status");
    return value as BoostyLinkStatus;
}
