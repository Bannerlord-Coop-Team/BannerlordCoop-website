const SERVER_CURSOR_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

/** Keeps the last confirmed cursor and request ID available after an interrupted page. */
export async function continueBatchMaintenance(
    batch: { requestId: string; cursor?: string },
    input: Record<string, unknown>,
    send: (page: { requestId: string; input: Record<string, unknown> }) => Promise<unknown>,
): Promise<unknown> {
    for (;;) {
        const previous = batch.cursor;
        const result = await send({ requestId: batch.requestId, input: previous === undefined ? input : { ...input, cursor: previous } });
        // Both a legacy response without a cursor and an explicit null are terminal.
        if (typeof result !== "object" || result === null || !("nextCursor" in result) || result.nextCursor == null) return result;
        const next = result.nextCursor;
        if (typeof next !== "string" || !SERVER_CURSOR_PATTERN.test(next) || (previous !== undefined && next <= previous)) {
            throw new Error("Batch maintenance returned an invalid continuation.");
        }
        batch.cursor = next;
    }
}
