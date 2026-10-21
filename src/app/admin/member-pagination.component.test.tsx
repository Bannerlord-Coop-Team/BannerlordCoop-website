import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberPagination } from "@/app/components/admin/MemberPagination";
import { paginateItems } from "@/app/lib/pagination";
import { memberListHref, parseMemberListState } from "./member-list";

describe("member list state", () => {
    it("falls back to page 1 and the default size for untrusted input", () => {
        expect(parseMemberListState({ query: "  ada  ", page: "-3", size: "7" })).toEqual({ query: "ada", page: 1, size: 50 });
        expect(parseMemberListState({ page: "2.5", size: "100" })).toEqual({ query: "", page: 1, size: 100 });
        expect(parseMemberListState({ page: "4", size: "25" })).toEqual({ query: "", page: 4, size: 25 });
    });

    it("omits default values from list links and keeps extra status params", () => {
        expect(memberListHref({ query: "", page: 1, size: 50 })).toBe("/admin");
        expect(memberListHref({ query: "ada", page: 3, size: 25 }, { updated: "Saved" })).toBe("/admin?updated=Saved&q=ada&page=3&size=25");
    });
});

describe("member pagination", () => {
    it("clamps an out-of-range page to the last page", () => {
        const slice = paginateItems(Array.from({ length: 120 }, (_, index) => index), 9, 50);
        expect(slice).toMatchObject({ page: 3, pageCount: 3, start: 101, end: 120 });
        expect(slice.items).toHaveLength(20);
    });

    it("links neighbouring pages and resets to page 1 when the size changes", () => {
        const listState = { query: "ada", page: 2, size: 25 } as const;
        const html = renderToStaticMarkup(
            <MemberPagination listState={listState} pagination={{ page: 2, pageCount: 3, start: 26, end: 50 }} total={70} />,
        );
        expect(html).toContain("Showing 26–50 of 70");
        expect(html).toContain('href="/admin?q=ada&amp;size=25"');
        expect(html).toContain('href="/admin?q=ada&amp;page=3&amp;size=25"');
        expect(html).toContain('href="/admin?q=ada&amp;size=100"');
    });

    it("disables previous and next at the edges", () => {
        const html = renderToStaticMarkup(
            <MemberPagination listState={{ query: "", page: 1, size: 50 }} pagination={{ page: 1, pageCount: 1, start: 1, end: 3 }} total={3} />,
        );
        expect(html).toContain('<span aria-disabled="true"');
        expect(html).not.toContain(">Previous</a>");
        expect(html).not.toContain(">Next</a>");
    });
});
