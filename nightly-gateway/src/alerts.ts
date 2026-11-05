// Every isolate uses the existing D1 binding for this atomic claim. The unique
// claim ID distinguishes requests even when they arrive in the same second.
export const DISCORD_ALERT_CLAIM_SQL = `
    INSERT INTO discord_alerts (error_kind, first_occurrence_at, occurrence_count, last_claimed_at, claim_id)
    VALUES (?, unixepoch(), 1, unixepoch(), ?)
    ON CONFLICT(error_kind) DO UPDATE SET
        occurrence_count = discord_alerts.occurrence_count + 1,
        claim_id = CASE WHEN discord_alerts.last_claimed_at <= unixepoch() - 3600
            THEN excluded.claim_id ELSE discord_alerts.claim_id END,
        last_claimed_at = CASE WHEN discord_alerts.last_claimed_at <= unixepoch() - 3600
            THEN excluded.last_claimed_at ELSE discord_alerts.last_claimed_at END
    RETURNING first_occurrence_at, occurrence_count, claim_id
`;

type AlertClaimDatabase = {
    prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } };
};

export async function claimDiscordAlert(database: AlertClaimDatabase, kind: string) {
    const claimId = crypto.randomUUID();
    const row = await database.prepare(DISCORD_ALERT_CLAIM_SQL).bind(kind, claimId).first<{
        first_occurrence_at: number;
        occurrence_count: number;
        claim_id: string;
    }>();
    if (row === null || !Number.isSafeInteger(row.first_occurrence_at) || row.first_occurrence_at <= 0
        || !Number.isSafeInteger(row.occurrence_count) || row.occurrence_count <= 0
        || typeof row.claim_id !== "string") {
        throw new Error("discord_alert_claim_invalid");
    }
    return {
        claimed: row.claim_id === claimId,
        firstOccurrence: new Date(row.first_occurrence_at * 1000).toISOString(),
        count: row.occurrence_count,
    };
}
