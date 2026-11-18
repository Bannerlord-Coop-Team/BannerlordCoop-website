import type { HostingPage } from "./types";

/** Maximum number of control-plane pages one server render may read for a collection. */
export const MAXIMUM_ADMIN_READ_PAGES = 5;
export const ADMIN_READ_PAGE_LIMIT = 100;

export type BoundedHostingPage<T> = HostingPage<T> & {
    pagesRead: number;
    partial: boolean;
};

/** Reads a cursor stream up to the fixed render budget and exposes an explicit partial state. */
export async function readBoundedHostingPage<T>(
    readPage: (cursor: string | null) => Promise<HostingPage<T>>,
    initialCursor: string | null = null,
    maxPages = MAXIMUM_ADMIN_READ_PAGES,
): Promise<BoundedHostingPage<T>> {
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAXIMUM_ADMIN_READ_PAGES) {
        throw new Error("Invalid control-plane page budget.");
    }

    const items: T[] = [];
    const cursors = new Set<string>();
    let cursor = initialCursor;
    let pagesRead = 0;
    for (; pagesRead < maxPages; pagesRead += 1) {
        const page = await readPage(cursor);
        items.push(...page.items);
        if (page.nextCursor === null) {
            return { items, nextCursor: null, pagesRead: pagesRead + 1, partial: false };
        }
        if (cursors.has(page.nextCursor)) throw new Error("Repeated control-plane page cursor.");
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
    }
    return { items, nextCursor: cursor, pagesRead, partial: true };
}
