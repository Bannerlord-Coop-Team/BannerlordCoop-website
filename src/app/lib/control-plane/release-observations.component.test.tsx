// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReleaseBuild } from "./types";

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
import { recordReleaseFirstObservations } from "./release-observations";

const FIRST = "2026-09-28T12:00:00.000Z";
const LATER = "2026-10-02T18:00:00.000Z";
const build: ReleaseBuild = {
    buildId: "v0.1.6-nightly", channel: "nightly", version: "v0.1.6", sourceRevision: "registry-observed",
    supportedGameVersion: "v1.4.8", validationState: "validated", publishedAt: LATER, updatedAt: LATER,
    registryMetadata: { versionTag: "v0.1.6-nightly", clientRevision: "b".repeat(40), serverRevision: "c".repeat(40) },
    container: { manifestDigest: `sha256:${"a".repeat(64)}` },
};
let database: Map<string, string>;
let now: string;
let race: boolean;
let read: ReturnType<typeof vi.fn>;
let insert: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetAllMocks();
    database = new Map(); now = FIRST; race = false;
    read = vi.fn(async (_column: string, ids: string[]) => ({ error: null,
        data: ids.filter(id => database.has(id)).map(release_id => ({ release_id, first_observed_at: database.get(release_id) })),
    }));
    insert = vi.fn(async (rows: { release_id: string }[], options: object) => {
        expect(options).toEqual({ onConflict: "release_id", ignoreDuplicates: true });
        for (const row of rows) if (!database.has(row.release_id)) database.set(row.release_id, race ? FIRST : now);
        return { error: null };
    });
    mocks.admin.mockReturnValue({ from: (table: string) => {
        expect(table).toBe("release_observations");
        return {
            select: () => ({ in: (column: string, ids: string[]) => ({ abortSignal: () => read(column, ids) }) }),
            upsert: (rows: { release_id: string }[], options: object) => ({ abortSignal: () => insert(rows, options) }),
        };
    } });
});

it("retains first observation across fresh responses, new requests and alias changes; a new digest gets its own date", async () => {
    expect((await recordReleaseFirstObservations([build]))[0].firstObservedAt).toBe(FIRST);
    now = LATER;
    const second = { ...build, currentChannel: false, publishedAt: LATER, updatedAt: LATER };
    const reloaded = (await recordReleaseFirstObservations([second]))[0];
    expect(reloaded.firstObservedAt).toBe(FIRST);
    expect(reloaded.publishedAt).toBe(LATER);
    expect(insert).toHaveBeenCalledTimes(1);
    const replacement = { ...build, container: { manifestDigest: `sha256:${"d".repeat(64)}` } };
    expect((await recordReleaseFirstObservations([replacement]))[0].firstObservedAt).toBe(LATER);
    expect((await recordReleaseFirstObservations([{ ...build, buildId: "renamed-nightly" }]))[0].firstObservedAt).toBe(FIRST);
    expect(database.size).toBe(2);
});

it("uses the first database insert when two page requests observe a new release concurrently", async () => {
    now = LATER; race = true;
    expect((await recordReleaseFirstObservations([build]))[0].firstObservedAt).toBe(FIRST);
    expect(read).toHaveBeenCalledTimes(2);
});

it("keeps the same digest in distinct channels separate and leaves publisher dates unchanged", async () => {
    const legacy = { ...build, buildId: "legacy", registryMetadata: undefined };
    expect(await recordReleaseFirstObservations([legacy])).toEqual([legacy]);
    expect(mocks.admin).not.toHaveBeenCalled();
    await recordReleaseFirstObservations([build]); now = LATER;
    expect((await recordReleaseFirstObservations([{ ...build, buildId: "v0.1.6", channel: "stable" }]))[0].firstObservedAt).toBe(LATER);
});

it("rejects invalid identities and oversized catalogs before accessing privileged storage", async () => {
    await expect(recordReleaseFirstObservations([{ ...build, container: { manifestDigest: "unverified" } }])).rejects.toThrow("identity");
    await expect(recordReleaseFirstObservations(Array(101).fill(build))).rejects.toThrow("Too many");
    expect(mocks.admin).not.toHaveBeenCalled();
});

it("fails closed on storage failures or missing dates instead of displaying the current time", async () => {
    read.mockResolvedValueOnce({ data: null, error: { message: "private upstream detail" } });
    await expect(recordReleaseFirstObservations([build])).rejects.toThrow("could not be loaded");
    expect(insert).not.toHaveBeenCalled();
    insert.mockResolvedValueOnce({ error: {} });
    await expect(recordReleaseFirstObservations([build])).rejects.toThrow("could not be recorded");
    read.mockResolvedValue({ data: [], error: null });
    await expect(recordReleaseFirstObservations([build])).rejects.toThrow("incomplete");
});

it("gives only the website service role append-only access to first observation timestamps", async () => {
    const pg = new PGlite();
    try {
        await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
        await pg.exec(`CREATE SCHEMA control_plane;
            CREATE TABLE control_plane.release_builds (
                build_id text primary key, channel text, container_manifest_digest text,
                published_at text, source_revision text, distribution text);
            CREATE TABLE control_plane.registry_release_authorizations (build_id text primary key);
        `);
        const retainedDigest = `sha256:${"f".repeat(64)}`;
        for (const [id, date] of [["older", FIRST], ["newer", LATER], ["unverified", "2026-09-01T00:00:00.000Z"]]) {
            await pg.query("INSERT INTO control_plane.release_builds VALUES ($1, 'nightly', $2, $3, 'registry-observed', 'ghcr-container-v1')",
                [id, retainedDigest, date]);
            if (id !== "unverified") await pg.query("INSERT INTO control_plane.registry_release_authorizations VALUES ($1)", [id]);
        }
        await pg.exec(await readFile(new URL("../../../../supabase/migrations/202610020003_release_first_observations.sql", import.meta.url), "utf8"));
        await pg.exec("SET ROLE service_role;");
        const retained = await pg.query<{ first_observed_at: Date }>("SELECT first_observed_at FROM public.release_observations");
        expect(retained.rows).toHaveLength(1);
        expect(retained.rows[0].first_observed_at.toISOString()).toBe(FIRST);
        const id = `nightly-${"a".repeat(64)}`;
        await pg.query("INSERT INTO public.release_observations VALUES ($1, $2)", [id, FIRST]);
        await pg.query("INSERT INTO public.release_observations VALUES ($1, $2) ON CONFLICT (release_id) DO NOTHING", [id, LATER]);
        const result = await pg.query<{ first_observed_at: Date }>("SELECT first_observed_at FROM public.release_observations WHERE release_id = $1", [id]);
        expect(result.rows[0].first_observed_at.toISOString()).toBe(FIRST);
        await expect(pg.query("UPDATE public.release_observations SET first_observed_at = now()")).rejects.toThrow("permission denied");
        await expect(pg.query("DELETE FROM public.release_observations")).rejects.toThrow("permission denied");
        for (const role of ["anon", "authenticated"]) {
            await pg.exec(`SET ROLE ${role}`);
            await expect(pg.query("SELECT * FROM public.release_observations")).rejects.toThrow("permission denied");
            await expect(pg.query("INSERT INTO public.release_observations (release_id) VALUES ($1)", [id])).rejects.toThrow("permission denied");
        }
    } finally { await pg.close(); }
}, 20_000);
