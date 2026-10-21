import { MEMBER_PAGE_SIZES, memberListHref, type MemberListState } from "@/app/admin/member-list";
import type { PageSlice } from "@/app/lib/pagination";
import Link from "next/link";

const pageLinkClass = "inline-flex min-h-10 items-center border border-white/15 px-4 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-foreground-muted hover:border-gold/40 hover:text-gold";
const disabledPageClass = "inline-flex min-h-10 cursor-not-allowed items-center border border-white/15 px-4 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-foreground-muted opacity-40";

/** Renders the member table's range summary, page-size links, and previous/next page links. */
export function MemberPagination({
    listState,
    pagination,
    total,
}: {
    listState: MemberListState;
    pagination: Pick<PageSlice<unknown>, "page" | "pageCount" | "start" | "end">;
    total: number;
}) {
    return (
        <nav aria-label="Member pages" className="mt-4 flex flex-col gap-3 border border-white/10 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-foreground-muted">Showing {pagination.start}–{pagination.end} of {total}</p>
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-foreground-muted">Rows per page</span>
                <ul className="flex items-center gap-1">
                    {MEMBER_PAGE_SIZES.map((size) => (
                        <li key={size}>
                            <Link
                                href={memberListHref({ ...listState, page: 1, size })}
                                aria-current={size === listState.size ? "true" : undefined}
                                className={`inline-flex min-h-10 min-w-10 items-center justify-center border px-2 text-xs ${size === listState.size ? "border-gold/40 bg-gold/10 text-gold" : "border-white/15 text-foreground-muted hover:border-gold/40 hover:text-gold"}`}
                            >
                                {size}
                            </Link>
                        </li>
                    ))}
                </ul>
                <PageLink label="Previous" page={pagination.page - 1} enabled={pagination.page > 1} listState={listState} />
                <span className="text-xs text-foreground-muted">Page {pagination.page} of {pagination.pageCount}</span>
                <PageLink label="Next" page={pagination.page + 1} enabled={pagination.page < pagination.pageCount} listState={listState} />
            </div>
        </nav>
    );
}

/** Renders one previous/next link, or an inert placeholder when that page does not exist. */
function PageLink({ label, page, enabled, listState }: { label: string; page: number; enabled: boolean; listState: MemberListState }) {
    if (!enabled) return <span aria-disabled="true" className={disabledPageClass}>{label}</span>;
    return <Link href={memberListHref({ ...listState, page })} className={pageLinkClass}>{label}</Link>;
}
