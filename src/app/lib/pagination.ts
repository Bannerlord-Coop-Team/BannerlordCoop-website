export type PageSlice<T> = {
    page: number;
    pageCount: number;
    start: number;
    end: number;
    items: T[];
};

/** Slices one clamped page out of an in-memory list and reports its 1-based display range. */
export function paginateItems<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const current = Number.isInteger(page) ? Math.min(Math.max(page, 1), pageCount) : 1;
    const startIndex = (current - 1) * pageSize;
    const slice = items.slice(startIndex, startIndex + pageSize);
    return {
        page: current,
        pageCount,
        start: items.length === 0 ? 0 : startIndex + 1,
        end: startIndex + slice.length,
        items: slice,
    };
}
