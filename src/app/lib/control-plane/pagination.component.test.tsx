import { describe, expect, it } from "vitest";
import { MAXIMUM_ADMIN_READ_PAGES, readBoundedHostingPage } from "./pagination";

describe("bounded control-plane pagination", () => {
    it("follows cursors and returns more than one hundred items", async () => {
        const calls: (string | null)[] = [];
        const result = await readBoundedHostingPage(async cursor => {
            calls.push(cursor);
            return cursor === null
                ? { items: Array.from({ length: 100 }, (_, index) => index), nextCursor: "page-2" }
                : { items: [100], nextCursor: null };
        });
        expect(result.items).toHaveLength(101);
        expect(result.partial).toBe(false);
        expect(calls).toEqual([null, "page-2"]);
    });

    it("stops at the hard page budget and exposes the continuation", async () => {
        const calls: (string | null)[] = [];
        const result = await readBoundedHostingPage(async cursor => {
            calls.push(cursor);
            const page = calls.length;
            return { items: [page], nextCursor: `page-${page + 1}` };
        });
        expect(calls).toHaveLength(MAXIMUM_ADMIN_READ_PAGES);
        expect(result.pagesRead).toBe(MAXIMUM_ADMIN_READ_PAGES);
        expect(result.partial).toBe(true);
        expect(result.nextCursor).toBe(`page-${MAXIMUM_ADMIN_READ_PAGES + 1}`);
    });
});
