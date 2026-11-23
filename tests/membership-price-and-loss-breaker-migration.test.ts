import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createBreakerSchema, FRAGMENTS, installValidatorStandIns, lossBreakerDatabase, MIGRATION } from "./loss-breaker-database.ts";

const token = "aaaaaaaa-1111-4111-8111-111111111111";
// Fresh account ids for one breaker report.
const accounts = (count: number) => Array.from({ length: count }, () => crypto.randomUUID());

// Reads the three stand-in definitions as the migration sees them.
async function definitions(db: PGlite) {
    return (await db.query<{ patreon: string; boosty: string; linked: string }>(`select pg_get_functiondef('public.patreon_role_sync(text,text,text,jsonb)'::regprocedure) patreon,
        pg_get_functiondef('boosty_membership.valid_evidence(jsonb,text)'::regprocedure) boosty, pg_get_functiondef('boosty_membership.linked(jsonb)'::regprocedure) linked`)).rows[0];
}

test("the migration rewrites each fragment exactly once and aborts on a missing or duplicated one", async () => {
    const migration = await readFile(MIGRATION, "utf8");
    const db = new PGlite();
    try {
        await createBreakerSchema(db);
        const [loss, listed, fence] = FRAGMENTS.patreon;
        for (const [name, fragments] of [["missing Patreon loss fragment", { ...FRAGMENTS, patreon: [listed, fence] }],
            ["duplicated Patreon allow-list fragment", { ...FRAGMENTS, patreon: [loss, listed, listed, fence] }], ["missing Patreon fence fragment", { ...FRAGMENTS, patreon: [loss, listed] }],
            ["missing Boosty validator fragment", { ...FRAGMENTS, boosty: [] }], ["duplicated Boosty validator fragment", { ...FRAGMENTS, boosty: [...FRAGMENTS.boosty, ...FRAGMENTS.boosty] }],
            ["missing Boosty linked fragment", { ...FRAGMENTS, linked: [] }]] as const) {
            await installValidatorStandIns(db, fragments);
            const before = await definitions(db);
            await assert.rejects(db.exec(migration), /unexpected definition/u, name);
            await db.exec("rollback");
            assert.deepEqual(await definitions(db), before, `${name} leaves every function unchanged`);
        }
        await installValidatorStandIns(db, FRAGMENTS);
        await db.exec(migration);
        const { patreon, boosty, linked } = await definitions(db);
        for (const fragment of [loss, listed]) assert.equal(patreon.includes(fragment), false, fragment);
        assert.match(patreon, /'allocationFence',fence,'allocationLost',coalesce/u);
        assert.equal(boosty.includes(FRAGMENTS.boosty[0]), false);
        assert.match(linked, /'lost',h\.evidence \? 'paidAccessEndedAt',/u);
    } finally {
        await db.close();
    }
});

test("the breaker counts new loss per account over a rolling 6 hours against the linked population", async () => {
    const { db, link, lease, breaker } = await lossBreakerDatabase();
    try {
        const patreon = breaker("patreon");
        await assert.rejects(patreon(token, accounts(1)), /stale_loss_breaker_lease/u);
        await lease("patreon", token);
        await assert.rejects(patreon("bbbbbbbb-1111-4111-8111-111111111111", accounts(1)), /stale_loss_breaker_lease/u);
        await assert.rejects(db.query("select public.membership_loss_breaker('other', $1, '{}'::uuid[])", [token]), /invalid_loss_breaker_provider/u);
        await assert.rejects(db.query("select public.membership_loss_breaker('patreon', $1, array[null]::uuid[])", [token]), /invalid_loss_breaker_accounts/u);
        await link("patreon", 20);
        const quiet = { withhold: false, bypass: false, alert: false };
        // Small runs each below any per-run floor still trip once together they pass 25% of 20.
        assert.deepEqual(await patreon(token, accounts(2)), quiet);
        const repeated = accounts(2);
        assert.deepEqual(await patreon(token, repeated), quiet);
        assert.deepEqual(await patreon(token, repeated), quiet, "an account counts once in the window");
        assert.deepEqual(await patreon(token, accounts(1)), quiet, "5 of 20 is the threshold, not over it");
        assert.deepEqual(await patreon(token, accounts(1)), { withhold: true, bypass: false, alert: true }, "6 of 20 across four runs trips");
        assert.deepEqual(await patreon(token, accounts(1)), { withhold: true, bypass: false, alert: false }, "a second trip within 6 hours stays quiet");
        await db.exec("update public.membership_loss_breakers set alerted_at = now() - interval '6 hours 1 minute' where provider = 'patreon'");
        assert.deepEqual(await patreon(token, accounts(1)), { withhold: true, bypass: false, alert: true }, "the alert repeats after 6 hours");
        await db.exec("update public.membership_loss_observations set observed_at = now() - interval '6 hours 1 minute'");
        assert.deepEqual(await patreon(token, accounts(1)), quiet, "observations older than 6 hours drop out of the window");

        // The minimum population is 10 linked members, and each provider keeps its own window.
        const boosty = breaker("boosty");
        await lease("boosty", token);
        await link("boosty", 9);
        assert.deepEqual(await boosty(token, accounts(9)), quiet, "9 linked Boosty members never trip");
        assert.equal((await db.query<{ count: number }>("select count(*)::int count from public.membership_loss_observations where provider = 'patreon'")).rows[0].count, 1);
    } finally {
        await db.close();
    }
});

test("an audited operator allowance lets a confirmed mass loss through for at most 24 hours and keeps alerting", async () => {
    const { db, link, lease, breaker } = await lossBreakerDatabase();
    try {
        const patreon = breaker("patreon");
        await lease("patreon", token);
        await link("patreon", 10);
        const allow = (hours: number | null, by: string | null, reason: string | null, provider = "patreon") =>
            db.query("select public.membership_loss_breaker_allow($1, $2, $3, $4) result", [provider, hours, by, reason]);
        for (const [hours, by, reason, provider, error] of [[0, "ops", "first refresh after the $20 policy", "patreon", /invalid_loss_breaker_window/u],
            [25, "ops", "first refresh after the $20 policy", "patreon", /invalid_loss_breaker_window/u], [3, " ", "first refresh after the $20 policy", "patreon", /check constraint/u],
            [3, null, "first refresh after the $20 policy", "patreon", /check constraint/u], [3, "ops", "too short", "patreon", /check constraint/u],
            [3, "ops", "first refresh after the $20 policy", "other", /invalid_loss_breaker_provider/u]] as const) {
            await assert.rejects(allow(hours, by, reason, provider), error, `${hours} ${by} ${reason} ${provider}`);
        }
        await assert.rejects(db.exec("update public.membership_loss_breakers set allowed_at = now(), allowed_until = now() + interval '25 hours', allowed_by = 'ops', allowed_reason = 'longer than a day' where provider = 'patreon'"),
            /check constraint/u, "raw SQL cannot exceed 24 hours");
        await assert.rejects(db.exec("update public.membership_loss_breakers set allowed_until = now() + interval '1 hour' where provider = 'patreon'"), /check constraint/u, "an allowance needs who and why");
        const privileges = (await db.query<{ allow: boolean; check: boolean }>(`select has_function_privilege('service_role', 'public.membership_loss_breaker_allow(text,integer,text,text)', 'execute') allow,
            has_function_privilege('service_role', 'public.membership_loss_breaker(text,uuid,uuid[])', 'execute') "check"`)).rows[0];
        assert.deepEqual(privileges, { allow: false, check: true }, "Edge functions can report trips but never allow loss");

        await allow(3, "ops@example.invalid", "first refresh after the $20 policy");
        const row = (await db.query<{ hours: number; allowed_by: string; allowed_reason: string }>(`select extract(epoch from allowed_until - allowed_at) / 3600 hours, allowed_by, allowed_reason
            from public.membership_loss_breakers where provider = 'patreon'`)).rows[0];
        assert.deepEqual({ ...row, hours: Number(row.hours) }, { hours: 3, allowed_by: "ops@example.invalid", allowed_reason: "first refresh after the $20 policy" });
        assert.deepEqual(await patreon(token, Array.from({ length: 3 }, () => crypto.randomUUID())), { withhold: false, bypass: true, alert: true }, "the allowance lets loss through and still alerts");
        assert.deepEqual(await patreon(token, [crypto.randomUUID()]), { withhold: false, bypass: true, alert: false }, "alerts stay throttled during the allowance");
        await db.exec("update public.membership_loss_breakers set allowed_at = now() - interval '4 hours', allowed_until = now() - interval '1 hour' where provider = 'patreon'");
        assert.deepEqual(await patreon(token, [crypto.randomUUID()]), { withhold: true, bypass: false, alert: false }, "an expired allowance withholds again");
    } finally {
        await db.close();
    }
});
