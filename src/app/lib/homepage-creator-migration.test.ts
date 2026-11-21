import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before, describe } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { homepageCreatorQuery, homepageCreatorTable } from "./homepage-creator-table";

type Row = Record<string, string | boolean | null>;

const migrations = [
    "20261121132421_create_homepage_creators.sql",
    "20261121135021_homepage_creators_youtube_profile_check.sql",
];

// The creators the first migration seeds, in display order: YouTube channel IDs, or the custom profile's name.
const seededCreators = [
    "UCNjxbL33FhDGeIOp3vd3ndg", // @JackieFishHD
    "UCi3M2mzQBc9sjfl1TzWCWgQ", // @ResonantRTS
    "CaptainFRACAS",
    "UC5gsrZTtWG_AqDFmuq81Q-w", // @RimmyDownunder
    "UC45a_j76kNDwJvbc2ufOkJg", // @PixelatedApollo
    "UCnQC_XGCCI__qrxwgZS27-A", // @Bokoen1
    "UC9sy-WPppdluS2q3crOaFpA", // Bannerlord Co-op
];

// Minimal valid rows; every rejection case below changes exactly one column of one of them.
const youTubeBase: Row = { source: "youtube", channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa" };
const customBase: Row = { source: "custom", name: "Streamer", href: "https://example.com" };

// Creates a disposable database with the Supabase roles and every homepage creator migration applied.
async function migratedDatabase(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    for (const name of migrations) {
        await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    }
    return db;
}

// Inserts one homepage_creators row through a parameterized statement built from its columns, on a database or transaction.
function insertCreator(db: Pick<PGlite, "query">, row: Row) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    return db.query(`insert into homepage_creators (${columns.join(", ")}) values (${placeholders.join(", ")})`, Object.values(row));
}

// Translates the loader's PostgREST query (eq filters, column.direction ordering) into SQL naming the same columns.
function toSql(table: string, { select, order, ...filters }: Record<string, string>): string {
    const where = Object.entries(filters).map(([column, filter]) => {
        if (!filter.startsWith("eq.")) throw new Error(`Unsupported PostgREST filter ${filter}.`);
        return `${column} = ${filter.slice("eq.".length)}`;
    });
    const orderBy = order.split(",").map((term) => {
        const [column, direction, ...modifiers] = term.split(".");
        if (modifiers.length > 0) throw new Error(`Unsupported PostgREST order ${term}.`);
        return `${column} ${direction}`;
    });
    return `select ${select} from ${table} where ${where.join(" and ")} order by ${orderBy.join(", ")}`;
}

test("seeds the previous creator list, which the loader's query returns in display order", async () => {
    const db = await migratedDatabase();
    try {
        const rows = (await db.query<Row>(toSql(homepageCreatorTable, homepageCreatorQuery))).rows;
        assert.deepEqual(rows.map((row) => row.channel_id ?? row.name), seededCreators);
        assert.equal(rows.find((row) => row.name === "CaptainFRACAS")?.href, "https://www.twitch.tv/captainfracas");
    } finally {
        await db.close();
    }
});

const youTubeCheck = "homepage_creators_youtube_channel";
const customCheck = "homepage_creators_custom_profile";
const rejectedRows = [
    { label: "a YouTube @handle", constraint: youTubeCheck, row: { ...youTubeBase, channel_id: "@Bokoen1" } },
    { label: "a YouTube row without a channel", constraint: youTubeCheck, row: { ...youTubeBase, channel_id: null } },
    { label: "a YouTube row with a name override", constraint: youTubeCheck, row: { ...youTubeBase, name: "Override" } },
    { label: "a YouTube row with an avatar override", constraint: youTubeCheck, row: { ...youTubeBase, avatar: "https://yt3.ggpht.com/a.jpg" } },
    { label: "a YouTube row with a description override", constraint: youTubeCheck, row: { ...youTubeBase, description: "Override" } },
    { label: "a YouTube row with an href override", constraint: youTubeCheck, row: { ...youTubeBase, href: "https://example.com/channel" } },
    { label: "a custom row with a non-HTTPS avatar", constraint: customCheck, row: { ...customBase, avatar: "http://example.com/a.png" } },
    { label: "a custom row without HTTPS", constraint: customCheck, row: { ...customBase, href: "http://example.com" } },
    { label: "a custom row with a blank name", constraint: customCheck, row: { ...customBase, name: "  " } },
    { label: "a custom row without a name", constraint: customCheck, row: { ...customBase, name: null } },
    { label: "a custom row without an href", constraint: customCheck, row: { ...customBase, href: null } },
    { label: "a custom row with a channel", constraint: customCheck, row: { ...customBase, channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa" } },
];

describe("write-time validation", () => {
    let db: PGlite;
    before(async () => { db = await migratedDatabase(); });
    after(async () => { await db.close(); });

    // The bases must be valid, or each rejection below could fail for an unrelated rule.
    test("accepts the minimal YouTube and custom rows", async () => {
        await db.transaction(async (tx) => {
            await insertCreator(tx, youTubeBase);
            await insertCreator(tx, customBase);
            await tx.rollback();
        });
    });

    for (const { label, constraint, row } of rejectedRows) {
        // Each malformed edit must fail at write time, where the editor sees it, not vanish from the homepage.
        test(`rejects ${label}`, async () => {
            await assert.rejects(insertCreator(db, row), new RegExp(`violates check constraint "${constraint}"`));
        });
    }

    test("rejects a second row for a seeded channel or link", async () => {
        await assert.rejects(insertCreator(db, { ...youTubeBase, channel_id: "UCNjxbL33FhDGeIOp3vd3ndg" }), /duplicate key value violates unique constraint/);
        await assert.rejects(insertCreator(db, { ...customBase, href: "https://www.twitch.tv/captainfracas" }), /duplicate key value violates unique constraint/);
    });
});

for (const role of ["anon", "authenticated"]) {
    // Website readers use these roles; they must see only published rows and must not be able to edit.
    test(`${role} reads only published creators and cannot write`, async () => {
        const db = await migratedDatabase();
        try {
            await insertCreator(db, { ...customBase, name: "Hidden", published: false });
            await db.exec(`set role ${role}`);
            const names = (await db.query<{ creator: string }>("select coalesce(name, channel_id) as creator from homepage_creators")).rows.map((row) => row.creator);
            assert.equal(names.length, seededCreators.length);
            assert.ok(!names.includes("Hidden"));
            await assert.rejects(insertCreator(db, { ...customBase, name: "Spam" }), /permission denied/);
            await assert.rejects(db.exec("update homepage_creators set published = false"), /permission denied/);
        } finally {
            await db.exec("reset role");
            await db.close();
        }
    });
}
