import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION = "supabase/migrations/20261123000000_membership_price_and_loss_breaker.sql";
const LOSS = "or v_evidence->'tierIds' is distinct from '[]'::jsonb";
const LISTED = " where policy->'qualifyingTierIds' @> jsonb_build_array(t)";
const FENCE = "jsonb_build_object('allocationFence',fence)";
const BOOSTY = " and e->'tierIds'='[]'::jsonb";
const LINKED = "'linkGeneration',h.link_generation::text,";
const token = "aaaaaaaa-1111-4111-8111-111111111111";

// Creates stand-in Patreon and Boosty functions whose bodies carry the given fragments as comments.
async function install(db: PGlite, patreon: string[], boosty: string[], linked: string[]) {
    const comments = (fragments: string[]) => fragments.map(fragment => `\n-- ${fragment}`).join("");
    await db.exec(`create or replace function public.patreon_role_sync(p_campaign text,p_tier text,p_operation text,p_input jsonb)
        returns jsonb language sql as $$ select null::jsonb${comments(patreon)}\n$$;
        create or replace function boosty_membership.valid_evidence(e jsonb, p_blog text) returns boolean language sql as $$ select true${comments(boosty)}\n$$;
        create or replace function boosty_membership.linked(p_input jsonb) returns jsonb language sql as $$ select null::jsonb${comments(linked)}\n$$;`);
}

// Reads the three stand-in definitions as the migration sees them.
async function definitions(db: PGlite) {
    return (await db.query<{ patreon: string; boosty: string; linked: string }>(`select pg_get_functiondef('public.patreon_role_sync(text,text,text,jsonb)'::regprocedure) patreon,
        pg_get_functiondef('boosty_membership.valid_evidence(jsonb,text)'::regprocedure) boosty, pg_get_functiondef('boosty_membership.linked(jsonb)'::regprocedure) linked`)).rows[0];
}

// Calls the breaker RPC as the Patreon worker holding `lease`.
async function trip(db: PGlite, lease = token) {
    return (await db.query<{ result: { bypass: boolean; alert: boolean } }>("select public.membership_loss_breaker('patreon', $1) result", [lease])).rows[0].result;
}

test("the migration rewrites each fragment exactly once, aborts on a missing or duplicated one, and the breaker alerts at most every 6 hours", async () => {
    const migration = await readFile(MIGRATION, "utf8");
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role; create schema boosty_membership; create schema patreon_roles;
            create table patreon_roles.sync_state(singleton boolean primary key default true, worker_token uuid, worker_until timestamptz);`);
        const all = [[LOSS, LISTED, FENCE], [BOOSTY], [LINKED]] as const;
        for (const [name, patreon, boosty, linked] of [["missing Patreon loss fragment", [LISTED, FENCE], [BOOSTY], [LINKED]],
            ["duplicated Patreon allow-list fragment", [LOSS, LISTED, LISTED, FENCE], [BOOSTY], [LINKED]], ["missing Patreon fence fragment", [LOSS, LISTED], [BOOSTY], [LINKED]],
            ["missing Boosty validator fragment", all[0], [], [LINKED]], ["duplicated Boosty validator fragment", all[0], [BOOSTY, BOOSTY], [LINKED]],
            ["missing Boosty linked fragment", all[0], [BOOSTY], []]] as const) {
            await install(db, [...patreon], [...boosty], [...linked]);
            const before = await definitions(db);
            await assert.rejects(db.exec(migration), /unexpected definition/u, name);
            await db.exec("rollback");
            assert.deepEqual(await definitions(db), before, `${name} leaves every function unchanged`);
        }
        await install(db, [...all[0]], [...all[1]], [...all[2]]);
        await db.exec(migration);
        const { patreon, boosty, linked } = await definitions(db);
        for (const fragment of [LOSS, LISTED]) assert.equal(patreon.includes(fragment), false, fragment);
        assert.match(patreon, /'allocationFence',fence,'allocationLost',coalesce/u);
        assert.equal(boosty.includes(BOOSTY), false);
        assert.match(linked, /'lost',h\.evidence \? 'paidAccessEndedAt',/u);

        // The breaker answers only the provider's current lease and alerts at most every 6 hours.
        await assert.rejects(trip(db), /stale_loss_breaker_lease/u);
        await db.query("insert into patreon_roles.sync_state values (true, $1, now() + interval '2 minutes')", [token]);
        await assert.rejects(trip(db, "bbbbbbbb-1111-4111-8111-111111111111"), /stale_loss_breaker_lease/u);
        await assert.rejects(db.query("select public.membership_loss_breaker('other', $1)", [token]), /invalid_loss_breaker_provider/u);
        assert.deepEqual(await trip(db), { bypass: false, alert: true });
        assert.deepEqual(await trip(db), { bypass: false, alert: false }, "a second trip within 6 hours stays quiet");
        await db.exec("update public.membership_loss_breakers set alerted_at = now() - interval '6 hours 1 minute' where provider = 'patreon'");
        assert.deepEqual(await trip(db), { bypass: false, alert: true }, "the alert repeats after 6 hours");
        await db.exec("update public.membership_loss_breakers set allowed_until = now() + interval '2 hours' where provider = 'patreon'");
        assert.deepEqual(await trip(db), { bypass: true, alert: false }, "an operator window allows the loss");
        const boostyRow = (await db.query<{ tripped_at: unknown }>("select tripped_at from public.membership_loss_breakers where provider = 'boosty'")).rows[0];
        assert.equal(boostyRow.tripped_at, null, "providers trip independently");
    } finally {
        await db.close();
    }
});
