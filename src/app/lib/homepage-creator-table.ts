// The creators table's read contract. Kept apart from homepage-creators.ts, with no `server-only` import, so the
// PGlite migration test can import it and run the loader's exact query against the migrated table.

export const homepageCreatorTable = "homepage_creators";

// Row shapes guaranteed by the table's CHECK constraints: YouTube rows carry only a channel, custom rows a full profile.
export type HomepageCreatorRow =
    | { id: string; source: "youtube"; channel_id: string }
    | { id: string; source: "custom"; name: string; description: string; avatar: string | null; href: string };

// The PostgREST query the loader sends for published creators in display order; the migration test runs every
// column it names against the migrated table.
export const homepageCreatorQuery = {
    select: "id,source,channel_id,name,description,avatar,href",
    published: "eq.true",
    order: "sort_order.asc,id.asc",
};
