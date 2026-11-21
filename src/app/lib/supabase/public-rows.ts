import "server-only";

export type PublicRowsQuery = Record<string, string>;

// How a loader reads its table; loaders default to fetchPublicRows and tests pass a fake that records the arguments.
export type PublicRowsReader<Row> = (table: string, query: PublicRowsQuery) => Promise<Row[]>;

// Optional overrides for the HTTP client and Supabase project; omitted ones default to global fetch and the public env.
export type PublicRowsOptions = {
    fetchImplementation?: typeof fetch;
    url?: string;
    key?: string;
};

// Reads rows from a publicly readable Supabase table through PostgREST with the publishable key and a 60-second
// revalidation. Returns no rows when Supabase is unconfigured (silently, for local runs) or when the request fails (logged).
export async function fetchPublicRows<Row>(table: string, query: PublicRowsQuery, {
    fetchImplementation = fetch,
    url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}: PublicRowsOptions = {}): Promise<Row[]> {
    if (!url || !key) return [];

    try {
        const response = await fetchImplementation(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, {
            headers: { apikey: key },
            next: { revalidate: 60 },
        });
        if (!response.ok) {
            console.error(`Unable to retrieve ${table} from Supabase: status ${response.status}.`);
            return [];
        }
        return (await response.json()) as Row[];
    } catch (error) {
        console.error(`Unable to retrieve ${table} from Supabase.`, error);
        return [];
    }
}
