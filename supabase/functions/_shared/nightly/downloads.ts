import type { GatewayQueries } from "./database.ts";

// The single writer of nightly_gateway.download_sessions: issuing a download session and revoking them.
// External reader: the Worker's authorizeDownload looks sessions up by token_hash (SHA-256 hex of the access
// token) and checks expires_at (epoch seconds), so those two columns are a contract with the Worker.

/** One download session to record: its token hash, device, member, sponsor and lifetime. */
export type NewDownloadSession = {
    tokenHash: string;
    deviceId: string;
    userId: string;
    sponsorId: string;
    createdAt: number;
    expiresAt: number;
};

/** Records a download session; a second session for the same device is PostgreSQL's unique_violation. */
export async function insertDownloadSession(tx: GatewayQueries, session: NewDownloadSession): Promise<void> {
    await tx.query(
        `INSERT INTO nightly_gateway.download_sessions
            (token_hash, device_session_id, discord_user_id, supporter_discord_user_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [session.tokenHash, session.deviceId, session.userId, session.sponsorId, session.createdAt, session.expiresAt],
    );
}

/** Ends every download session issued under a supporter, their own and their sponsored friends' alike. */
export async function revokeDownloadsForSupporter(tx: GatewayQueries, supporterId: string): Promise<void> {
    await tx.query("DELETE FROM nightly_gateway.download_sessions WHERE supporter_discord_user_id = $1", [supporterId]);
}

/** Ends a friend's download sessions: only those under `supporterId` when given, otherwise all of them. */
export async function revokeDownloadsForFriend(tx: GatewayQueries, friendId: string, supporterId?: string): Promise<void> {
    if (supporterId === undefined) {
        await tx.query("DELETE FROM nightly_gateway.download_sessions WHERE discord_user_id = $1", [friendId]);
        return;
    }
    await tx.query(
        "DELETE FROM nightly_gateway.download_sessions WHERE discord_user_id = $1 AND supporter_discord_user_id = $2",
        [friendId, supporterId],
    );
}
