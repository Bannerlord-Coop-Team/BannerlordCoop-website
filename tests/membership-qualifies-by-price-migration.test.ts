import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const LOSS = "or v_evidence->'tierIds' is distinct from '[]'::jsonb";
const LISTED = " where policy->'qualifyingTierIds' @> jsonb_build_array(t)";
const BOOSTY = " and e->'tierIds'='[]'::jsonb";

// Replaces both stand-in validators so their bodies carry the given clause text as comments.
async function install(db: PGlite, patreon: string[], boosty: string[]) {
    const comments = (clauses: string[]) => clauses.map(clause => `\n-- ${clause}`).join("");
    await db.exec(`create or replace function public.patreon_role_sync(p_campaign text,p_tier text,p_operation text,p_input jsonb)
        returns jsonb language sql as $$ select null::jsonb${comments(patreon)}\n$$;
        create or replace function boosty_membership.valid_evidence(e jsonb, p_blog text) returns boolean
        language sql as $$ select true${comments(boosty)}\n$$;`);
}

// Reads both stand-in definitions as the migration sees them.
async function definitions(db: PGlite) {
    const result = await db.query<{ patreon: string; boosty: string }>(`select pg_get_functiondef('public.patreon_role_sync(text,text,text,jsonb)'::regprocedure) patreon,
        pg_get_functiondef('boosty_membership.valid_evidence(jsonb,text)'::regprocedure) boosty`);
    return result.rows[0];
}

test("the price-qualification migration patches each clause exactly once and aborts on a missing or duplicated one", async () => {
    const migration = await readFile("supabase/migrations/20261123000000_membership_qualifies_by_price.sql", "utf8");
    const db = new PGlite();
    try {
        await db.exec("create schema boosty_membership");
        for (const [name, patreon, boosty] of [["missing Patreon loss clause", [LISTED], [BOOSTY]], ["duplicated Patreon allow-list clause", [LOSS, LISTED, LISTED], [BOOSTY]],
            ["missing Boosty clause", [LOSS, LISTED], []], ["duplicated Boosty clause", [LOSS, LISTED], [BOOSTY, BOOSTY]]] as const) {
            await install(db, [...patreon], [...boosty]);
            const before = await definitions(db);
            await assert.rejects(db.exec(migration), /unexpected definition/u, name);
            await db.exec("rollback");
            assert.deepEqual(await definitions(db), before, `${name} leaves both validators unchanged`);
        }
        await install(db, [LOSS, LISTED], [BOOSTY]);
        await db.exec(migration);
        const { patreon, boosty } = await definitions(db);
        for (const clause of [LOSS, LISTED]) assert.equal(patreon.includes(clause), false, clause);
        assert.equal(boosty.includes(BOOSTY), false);
    } finally {
        await db.close();
    }
});
