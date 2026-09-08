import { boundedJson, record } from "./membership.ts";

// PostgreSQL lock_not_available includes NOWAIT, try-fence refusal and lock_timeout.
// Messages/details are never authority and never leave the server boundary.
export function isDatabaseContention(value: unknown): boolean {
    return record(value) && value.code === "55P03";
}
export class DatabaseContention extends Error {}
export async function checkDatabaseContention(response: Response): Promise<void> {
    if (response.ok) return;
    let value: unknown;
    try { value = await boundedJson(response); } catch { return; }
    if (isDatabaseContention(value)) throw new DatabaseContention();
}
export function databaseContentionResponse(): Response {
    return Response.json({ error: "membership_retry" }, { status: 503, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
