export const MEMBER_PAGE_SIZES = [25, 50, 100] as const;
export type MemberPageSize = (typeof MEMBER_PAGE_SIZES)[number];
export const DEFAULT_MEMBER_PAGE_SIZE: MemberPageSize = 50;

export type MemberListState = {
    query: string;
    page: number;
    size: MemberPageSize;
};

type RawMemberListState = {
    query?: string | null;
    page?: string | null;
    size?: string | null;
};

/** Narrows untrusted page-size input to one of the offered member page sizes. */
function parsePageSize(value: string | null | undefined): MemberPageSize {
    const size = Number(value);
    return (MEMBER_PAGE_SIZES as readonly number[]).includes(size) ? (size as MemberPageSize) : DEFAULT_MEMBER_PAGE_SIZE;
}

/** Parses untrusted search, page, and size inputs into a bounded member list view. */
export function parseMemberListState(raw: RawMemberListState): MemberListState {
    const page = Number(raw.page);
    return {
        query: (raw.query ?? "").trim().slice(0, 100),
        page: Number.isSafeInteger(page) && page > 0 ? page : 1,
        size: parsePageSize(raw.size),
    };
}

/** Builds the /admin URL for a member list view, omitting defaults so links stay short. */
export function memberListHref(state: MemberListState, extra: Record<string, string> = {}) {
    const params = new URLSearchParams(extra);
    if (state.query) params.set("q", state.query);
    if (state.page > 1) params.set("page", String(state.page));
    if (state.size !== DEFAULT_MEMBER_PAGE_SIZE) params.set("size", String(state.size));
    const search = params.toString();
    return search ? `/admin?${search}` : "/admin";
}
