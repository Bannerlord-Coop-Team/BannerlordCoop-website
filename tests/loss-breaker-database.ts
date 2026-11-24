import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { LossBreaker, LossBreakerProvider, LossBreakerVerdict } from "../supabase/functions/_shared/loss-breaker.ts";

export const MIGRATION = "supabase/migrations/20261123000000_membership_price_and_loss_breaker.sql";
/** The exact fragments the migration rewrites, by stand-in function. */
export const FRAGMENTS = {
    patreon: ["or v_evidence->'tierIds' is distinct from '[]'::jsonb", " where policy->'qualifyingTierIds' @> jsonb_build_array(t)", "jsonb_build_object('allocationFence',fence)"],
    boosty: [" and e->'tierIds'='[]'::jsonb"],
    linked: ["'linkGeneration',h.link_generation::text,"],
};

/** Replaces the three stand-in functions so their bodies carry the given fragments as comments. */
export async function installValidatorStandIns(db: PGlite, fragments: { patreon: readonly string[]; boosty: readonly string[]; linked: readonly string[] }) {
    const comments = (list: readonly string[]) => list.map(fragment => `\n-- ${fragment}`).join("");
    await db.exec(`create or replace function public.patreon_role_sync(p_campaign text,p_tier text,p_operation text,p_input jsonb)
        returns jsonb language sql as $$ select null::jsonb${comments(fragments.patreon)}\n$$;
        create or replace function boosty_membership.valid_evidence(e jsonb, p_blog text) returns boolean language sql as $$ select true${comments(fragments.boosty)}\n$$;
        create or replace function boosty_membership.linked(p_input jsonb) returns jsonb language sql as $$ select null::jsonb${comments(fragments.linked)}\n$$;`);
}

/** Creates the roles, schemas and tables the migration and its breaker read, without any functions. */
export async function createBreakerSchema(db: PGlite) {
    await db.exec(`create role anon; create role authenticated; create role service_role;
        create schema boosty_membership; create schema patreon_roles;
        create table patreon_roles.sync_state(singleton boolean primary key default true, worker_token uuid, worker_until timestamptz);
        create table boosty_membership.sync_state(singleton boolean primary key default true, worker_token uuid, worker_until timestamptz);
        create function boosty_membership.require_lease(p_token uuid) returns void language plpgsql as $$ begin
            if p_token is null or not exists(select 1 from boosty_membership.sync_state where singleton and worker_token = p_token and worker_until > clock_timestamp()) then
                raise exception 'stale_boosty_lease'; end if; end $$;
        create table patreon_roles.memberships(member_id uuid primary key, patreon_user_id text);
        create table public.patreon_accounts(user_id uuid primary key, patreon_user_id text);
        create table public.membership_heads(account_id uuid primary key, patreon_user_id text, link_state text);
        create table public.membership_provider_heads(account_id uuid, provider text, link_state text);`);
}

/** Builds an isolated database with the migration applied over stand-ins, plus helpers to drive its breaker. */
export async function lossBreakerDatabase() {
    const db = new PGlite();
    await createBreakerSchema(db);
    await installValidatorStandIns(db, FRAGMENTS);
    await db.exec(await readFile(MIGRATION, "utf8"));
    return {
        db,
        /** Adds `count` linked members the provider's worker re-reads. */
        link: async (provider: LossBreakerProvider, count: number) => {
            if (provider === "boosty") return void await db.query("insert into public.membership_provider_heads select gen_random_uuid(), 'boosty', 'linked' from generate_series(1, $1)", [count]);
            await db.query(`with s as (select gen_random_uuid() account, gen_random_uuid() member, 'p' || gen_random_uuid() patreon from generate_series(1, $1)),
                a as (insert into public.patreon_accounts select account, patreon from s), h as (insert into public.membership_heads select account, patreon, 'linked' from s)
                insert into patreon_roles.memberships select member, patreon from s`, [count]);
        },
        /** Grants `token` the provider's current worker lease. */
        lease: async (provider: LossBreakerProvider, token: string) => {
            const table = provider === "patreon" ? "patreon_roles.sync_state" : "boosty_membership.sync_state";
            await db.query(`insert into ${table} values (true, $1, now() + interval '2 minutes') on conflict (singleton) do update set worker_token = excluded.worker_token, worker_until = excluded.worker_until`, [token]);
        },
        /** The real breaker RPC for one provider, as the worker calls it. */
        breaker: (provider: LossBreakerProvider): LossBreaker => sqlLossBreaker(db, provider),
    };
}

/** Calls `public.membership_loss_breaker` through `db` for one provider. */
export function sqlLossBreaker(db: PGlite, provider: LossBreakerProvider): LossBreaker {
    return async (token, accountIds) => (await db.query<{ verdict: LossBreakerVerdict }>(
        "select public.membership_loss_breaker($1, $2, array(select jsonb_array_elements_text($3::jsonb)::uuid)) verdict", [provider, token, JSON.stringify(accountIds)])).rows[0].verdict;
}
