import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const access = "seed-access-token-fixture-value", refresh = "seed-refresh-token-fixture-value";
const rotatedAccess = "rotated-access-token-fixture", rotatedRefresh = "rotated-refresh-token-fixture";
let db: PGlite;

before(async () => {
    db = new PGlite();
    // Vault stub: the real extension encrypts at rest; the contract used here is the create/update
    // functions plus the decrypted view keyed by secret id.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key,email_confirmed_at timestamptz,
            deleted_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb default '{}',updated_at timestamptz default now());
        create schema vault;
        create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
        create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret from vault.secrets;
        create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
        returns uuid language sql as $$
            insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id;
        $$;
        create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
        returns void language sql as $$
            update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description) where id = secret_id;
        $$;`);
    for (const name of ["20260907212654_create_patreon_links", "20260907220000_patreon_website_roles", "20261009170000_patreon_creator_token_refresh"]) {
        await db.exec(await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
    }
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("reset role; truncate patreon_roles.creator_token, vault.secrets cascade"); });

async function rpc(operation: string, input: Record<string, unknown> = {}) {
    return (await db.query<{ result: Record<string, unknown> | null }>("select public.patreon_creator_token($1,$2::jsonb) as result",
        [operation, JSON.stringify(input)])).rows[0].result as Record<string, unknown>;
}
async function row() {
    return (await db.query<{ generation: number; expires_at: string | null; lease_until: string | null; last_failure: string | null; secrets: number }>(
        "select generation, expires_at, lease_until, last_failure, (select count(*) from vault.secrets)::int as secrets from patreon_roles.creator_token")).rows[0];
}
async function secrets() {
    return (await db.query<{ name: string; secret: string }>("select name, secret from vault.secrets order by name")).rows;
}

test("unconfigured store reads as such; seeding stores both tokens in Vault and makes refresh due", async () => {
    assert.deepEqual(await rpc("read"), { configured: false, generation: 0 });
    assert.deepEqual(await rpc("seed", { accessToken: access, refreshToken: refresh }), { seeded: true, generation: 1 });
    assert.deepEqual(await rpc("read"), { configured: true, accessToken: access, generation: 1, expiresAt: null, refreshDue: true });
    assert.deepEqual(await secrets(), [{ name: "patreon_creator_access_token", secret: access }, { name: "patreon_creator_refresh_token", secret: refresh }]);
    // Seeding again keeps the first pair; concurrent workers never overwrite a rotated token.
    assert.deepEqual(await rpc("seed", { accessToken: "other-access-token-fixture", refreshToken: "other-refresh-token-fixture" }), { stale: true, generation: 1 });
    assert.equal((await rpc("read")).accessToken, access);
});

test("refresh rotates both secrets under a lease and advances the generation", async () => {
    await rpc("seed", { accessToken: access, refreshToken: refresh });
    assert.deepEqual(await rpc("refresh_begin", { generation: 1 }), { refreshToken: refresh, generation: 1 });
    assert.deepEqual(await rpc("refresh_begin", { generation: 1 }), { busy: true });
    assert.deepEqual(await rpc("refresh_commit", { generation: 1, accessToken: rotatedAccess, refreshToken: rotatedRefresh, expiresIn: 2678400 }), { rotated: true, generation: 2 });
    const state = await rpc("read");
    assert.equal(state.accessToken, rotatedAccess);
    assert.equal(state.generation, 2);
    assert.equal(state.refreshDue, false);
    assert.deepEqual(await secrets(), [{ name: "patreon_creator_access_token", secret: rotatedAccess }, { name: "patreon_creator_refresh_token", secret: rotatedRefresh }]);
    const current = await row();
    assert.equal(current.lease_until, null);
    assert.equal(current.secrets, 2);
    // Refresh becomes due within seven days of expiry.
    await db.exec("update patreon_roles.creator_token set expires_at = now() + interval '6 days'");
    assert.equal((await rpc("read")).refreshDue, true);
});

test("stale generations, expired leases and commits without a lease are refused", async () => {
    await rpc("seed", { accessToken: access, refreshToken: refresh });
    assert.deepEqual(await rpc("refresh_commit", { generation: 1, accessToken: rotatedAccess, refreshToken: rotatedRefresh, expiresIn: 2678400 }), { stale: true, generation: 1 });
    assert.deepEqual(await rpc("refresh_begin", { generation: 2 }), { stale: true, generation: 1 });
    await rpc("refresh_begin", { generation: 1 });
    await db.exec("update patreon_roles.creator_token set lease_until = now() - interval '1 second'");
    assert.deepEqual(await rpc("refresh_commit", { generation: 1, accessToken: rotatedAccess, refreshToken: rotatedRefresh, expiresIn: 2678400 }), { stale: true, generation: 1 });
    assert.equal((await rpc("read")).accessToken, access);
    // An expired lease can be re-acquired.
    assert.deepEqual(await rpc("refresh_begin", { generation: 1 }), { refreshToken: refresh, generation: 1 });
});

test("a failed refresh releases the lease and records only a fixed reason", async () => {
    await rpc("seed", { accessToken: access, refreshToken: refresh });
    await rpc("refresh_begin", { generation: 1 });
    // Only the two fixed reasons are accepted; free text never reaches the table.
    await assert.rejects(rpc("refresh_failed", { generation: 1, reason: "secret detail" }));
    assert.deepEqual(await rpc("refresh_failed", { generation: 1, reason: "rejected" }), { recorded: true });
    const current = await row();
    assert.equal(current.lease_until, null);
    assert.equal(current.last_failure, "rejected");
    assert.equal(current.generation, 1);
    // Without a lease a late failure report is stale, and the lease can be taken again.
    assert.deepEqual(await rpc("refresh_failed", { generation: 1, reason: "unavailable" }), { stale: true, generation: 1 });
    assert.deepEqual(await rpc("refresh_begin", { generation: 1 }), { refreshToken: refresh, generation: 1 });
});

test("malformed tokens, expiries and operations are rejected", async () => {
    await assert.rejects(rpc("seed", { accessToken: "short", refreshToken: refresh }));
    await assert.rejects(rpc("seed", { accessToken: "contains a space in the token", refreshToken: refresh }));
    await assert.rejects(rpc("seed", { accessToken: access, refreshToken: access }));
    await rpc("seed", { accessToken: access, refreshToken: refresh });
    await rpc("refresh_begin", { generation: 1 });
    for (const input of [
        { accessToken: rotatedAccess, refreshToken: rotatedRefresh, expiresIn: 10 },
        { accessToken: rotatedAccess, refreshToken: rotatedRefresh, expiresIn: "2678400" },
        { accessToken: rotatedAccess, refreshToken: rotatedRefresh, expiresIn: 400 * 86400 },
        { accessToken: rotatedAccess, refreshToken: rotatedAccess, expiresIn: 2678400 },
    ]) await assert.rejects(rpc("refresh_commit", { generation: 1, ...input }));
    await assert.rejects(rpc("rotate", {}));
    await assert.rejects(rpc("refresh_begin", { generation: 0 }));
    assert.equal((await rpc("read")).accessToken, access);
});

test("reset removes the Vault pair so the next worker call seeds from the function secrets again", async () => {
    await rpc("seed", { accessToken: access, refreshToken: refresh });
    assert.deepEqual(await rpc("reset"), { reset: true });
    assert.deepEqual(await secrets(), []);
    assert.deepEqual(await rpc("read"), { configured: false, generation: 0 });
    assert.deepEqual(await rpc("seed", { accessToken: "other-access-token-fixture", refreshToken: "other-refresh-token-fixture" }), { seeded: true, generation: 1 });
});

test("only the service role may call the RPC and no role reads the table directly", async () => {
    await rpc("seed", { accessToken: access, refreshToken: refresh });
    for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        await assert.rejects(rpc("read"), /permission denied/);
        await assert.rejects(db.query("select * from patreon_roles.creator_token"), /permission denied/);
        await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await rpc("read")).accessToken, access);
    await assert.rejects(db.query("select * from patreon_roles.creator_token"), /permission denied/);
    await db.exec("reset role");
});
