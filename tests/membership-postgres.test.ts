// Real isolated PostgreSQL tests. WEBSITE_MEMBERSHIP_TEST_URL is fixture-only;
// no deployed database or Supabase credentials are read by this suite.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
const url = process.env.WEBSITE_MEMBERSHIP_TEST_URL;
const migration = "supabase/migrations/202609080002_membership_onboarding.sql";
const a = "aaaaaaaa-1111-4111-8111-111111111111", b = "bbbbbbbb-1111-4111-8111-111111111111";
const discord = "123456789012345678";
const evidence = { verification: "qualifying", campaignId: "10", memberId: "2", tierIds: ["20"], verifiedAt: "2026-09-07T12:00:00.000Z", paidThroughAt: null, policyVersion: "patreon-paid-usd20-v1", evidenceSha256: "e".repeat(64) };
test("membership migration and transactional recovery on real PostgreSQL", { skip: !url }, async t => {
    const target = new URL(url!);
    assert.ok(["127.0.0.1", "localhost"].includes(target.hostname) && target.pathname === "/website_membership_test", "Only the owned local fixture database is allowed");
    const client = new pg.Client({ connectionString: url }); await client.connect();
    const query = (sql: string, params: unknown[] = []) => client.query(sql, params);
    const rpc = async (name: string, args: unknown[]) => (await query(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(",")}) result`, args)).rows[0].result;
    try {
        await query("create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;");
        await query(await readFile("supabase/migrations/20260907212654_create_patreon_links.sql", "utf8"));
        await query("insert into auth.users values($1),($2)", [a,b]);
        await query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,'1')",[a]);
        await query(await readFile(migration,"utf8"));
        await t.test("populated identity-only history stays unverified and all new tables deny browser reads", async () => {
            const h = await rpc("membership_fence", [a,discord,false]); assert.equal(h.verification,"unverified"); assert.equal(h.linkGeneration,"2");
            for (const table of ["membership_heads","membership_outbox","membership_completion_receipts","discord_link_requests"]) {
                assert.equal((await query("select relrowsecurity from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0].relrowsecurity,true);
                assert.equal((await query("select has_table_privilege('authenticated',$1,'select') permitted",[`public.${table}`])).rows[0].permitted,false);
            }
            assert.equal((await query("select has_function_privilege('anon','public.membership_complete(uuid,text,text)','execute') permitted")).rows[0].permitted,false);
            await query("set role authenticated");
            try { await assert.rejects(query("select * from public.membership_heads")); await assert.rejects(rpc("membership_fence",[a,discord,false])); }
            finally { await query("reset role"); }
            await query("set role service_role");
            try { assert.equal((await rpc("membership_fence",[a,discord,false])).accountId,a); await assert.rejects(query("select * from public.membership_heads")); }
            finally { await query("reset role"); }

        });
        async function stage(account = a, token = "a".repeat(64), patreon = "1", expired = false) {
            const h = await rpc("membership_fence",[account,discord,false]);
            await query("insert into public.patreon_oauth_states(token_hash,kind,user_id,patreon_user_id,expires_at,operation_id,expected_generation,return_path,evidence) values($1,'complete',$2,$3,clock_timestamp()+($4::text)::interval,gen_random_uuid(),$5,'/servers',$6)",[token,account,patreon,expired ? "-1 minute" : "10 minutes",h.linkGeneration,evidence]);
            return token;
        }
        let token: string;
        await t.test("transaction failure leaves completion authority, identity and outbox intact", async () => {
            token = await stage();
            const before = (await query("select count(*) from public.membership_outbox")).rows[0].count;
            await query("create function public.test_fail_outbox() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$; create trigger test_fail_outbox before insert on public.membership_outbox for each row execute function public.test_fail_outbox()");
            await assert.rejects(rpc("membership_complete",[a,discord,token]));
            assert.equal((await query("select count(*) from public.patreon_oauth_states where token_hash=$1",[token])).rows[0].count,"1");
            assert.equal((await query("select count(*) from public.membership_outbox")).rows[0].count,before);
            await query("drop trigger test_fail_outbox on public.membership_outbox; drop function public.test_fail_outbox()");
        });
        await t.test("same completion races return one immutable receipt; another account cannot consume or recover it", async () => {
            const peer = new pg.Client({ connectionString: url }); await peer.connect();
            try {
                const results = await Promise.all([rpc("membership_complete",[a,discord,token!]),peer.query("select public.membership_complete($1,$2,$3) result",[a,discord,token!]).then(r=>r.rows[0].result)]);
                assert.deepEqual(results[0],results[1]); assert.equal(results[0].returnPath,"/servers");
                assert.equal((await query("select count(*) from public.membership_completion_receipts")).rows[0].count,"1");
                await assert.rejects(rpc("membership_complete",[b,discord,token!]));
            } finally { await peer.end(); }
        });
        await t.test("unlink and current Discord changes invalidate evidence; receipts survive expiry and unlink", async () => {
            const positive = await rpc("membership_fence",[a,discord,false]); assert.equal(positive.verification,"qualifying");
            const changed = await rpc("membership_fence",[a,"999456789012345678",false]); assert.equal(changed.verification,"unverified"); assert.ok(BigInt(changed.linkGeneration)>BigInt(positive.linkGeneration));
            const unlinked = await rpc("membership_unlink",[a,"999456789012345678"]); assert.equal(unlinked.linkState,"unlinked");
            assert.equal((await rpc("membership_complete",[a,"999456789012345678",token!])).linked,true);
            assert.equal((await rpc("membership_fence",[a,"999456789012345678",false])).patreonUserId,null);
        });
        await t.test("generation change, expired authority and foreign Patreon uniqueness fail atomically", async () => {
            const stale = await stage(a,"b".repeat(64)); await rpc("membership_fence",[a,"999456789012345678",false]);
            await assert.rejects(rpc("membership_complete",[a,"999456789012345678",stale]));
            const expired = await stage(a,"c".repeat(64),"1",true); await assert.rejects(rpc("membership_complete",[a,discord,expired]));
            const current = await stage(a,"d".repeat(64)); await rpc("membership_complete",[a,discord,current]);
            const foreign = await stage(b,"f".repeat(64)); await assert.rejects(rpc("membership_complete",[b,discord,foreign]));
            assert.equal((await query("select user_id from public.patreon_accounts where patreon_user_id='1'")).rows[0].user_id,a);
        });
        await t.test("outbox restart/ack response loss replays exact receipt, conflict cannot rewrite ack", async () => {
            const page = await rpc("membership_changes",[null,50]); assert.ok(page.events.length>0);
            const event = page.events[0]; const receipt = "cccccccc-1111-4111-8111-111111111111";
            const result = await rpc("membership_ack",[event.eventId,receipt]); assert.deepEqual(await rpc("membership_ack",[event.eventId,receipt]),result);
            await assert.rejects(rpc("membership_ack",[event.eventId,"dddddddd-1111-4111-8111-111111111111"]));
            assert.ok(!(await rpc("membership_changes",[null,50])).events.some((e: {eventId:string})=>e.eventId===event.eventId));
            const empty = await rpc("membership_changes",[page.cursor,50]); assert.deepEqual(empty,{version:1,cursor:page.cursor,events:[]});
        });
        await t.test("Discord requests are initiating-UUID bound, expire, and permit exact confirmation replay", async () => {
            const token = "9".repeat(64); await rpc("membership_discord_begin",[b,token,"eeeeeeee-1111-4111-8111-111111111111","/servers"]);
            await assert.rejects(rpc("membership_discord_check",[a,token]));
            assert.equal((await rpc("membership_discord_check",[b,token])).valid,true);
            const result = await rpc("membership_discord_confirm",[b,token,discord]); assert.deepEqual(await rpc("membership_discord_confirm",[b,token,discord]),result);
            await assert.rejects(rpc("membership_discord_confirm",[b,token,"999456789012345678"]));
            await query("update public.discord_link_requests set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",[token]); await assert.rejects(rpc("membership_discord_check",[b,token]));
        });
        await t.test("outbox commit ordering cannot skip a lower uncommitted sequence", async () => {
            const peer = new pg.Client({ connectionString: url }); await peer.connect();
            try {
                const before = await rpc("membership_changes",[null,50]);
                await query("begin"); await rpc("membership_unlink",[b,discord]);
                let finished = false;
                const waiting = peer.query("select public.membership_fence($1,$2,false)",[b,"999456789012345678"]).then(r=>{finished=true; return r;});
                await new Promise(resolve=>setTimeout(resolve,50)); assert.equal(finished,false);
                await query("commit"); await waiting;
                const after = await rpc("membership_changes",[before.cursor,50]); assert.ok(after.events.length>=2);
            } finally { await query("rollback"); await peer.end(); }
        });
        await t.test("explicit unlink fences even a pending initially-unlinked completion", async () => {
            await rpc("membership_unlink",[b,discord]);
            const pending = await stage(b,"8".repeat(64),"7");
            await rpc("membership_unlink",[b,discord]);
            await assert.rejects(rpc("membership_complete",[b,discord,pending]));
        });
        await t.test("new explicit OAuth checks fence reordered completions and expose verification pending separately from sync", async () => {
            await rpc("membership_begin",[b,discord,"12345678-1111-4111-8111-111111111111","1".repeat(64),"/servers"]);
            await query("update public.patreon_oauth_states set kind='complete',patreon_user_id='7',evidence=$1 where token_hash=$2",[evidence,"1".repeat(64)]);
            await rpc("membership_begin",[b,discord,"22345678-1111-4111-8111-111111111111","2".repeat(64),"/servers"]);
            assert.equal((await rpc("membership_status",[b,discord])).verificationPending,true);
            await query("update public.patreon_oauth_states set kind='complete',patreon_user_id='7',evidence=$1 where token_hash=$2",[{...evidence,verification:"nonqualifying"},"2".repeat(64)]);
            await rpc("membership_complete",[b,discord,"2".repeat(64)]);
            await assert.rejects(rpc("membership_complete",[b,discord,"1".repeat(64)]));
            const status = await rpc("membership_status",[b,discord]); assert.equal(status.snapshot.verification,"nonqualifying"); assert.equal(status.verificationPending,false);
        });
        await t.test("Auth deletion retains tombstone, outbox and receipts, forbids resurrection", async () => {
            const before = (await query("select count(*) from public.membership_completion_receipts")).rows[0].count;
            await query("delete from auth.users where id=$1",[a]);
            const tombstone = await rpc("membership_fence",[a,null,true]); assert.equal(tombstone.linkState,"account_deleted"); assert.equal(tombstone.verification,"unverified"); assert.equal(tombstone.patreonUserId,null);
            assert.equal((await query("select count(*) from public.membership_completion_receipts")).rows[0].count,before);
            await assert.rejects(rpc("membership_fence",[a,discord,false]));
        });
    } finally { await client.end(); }
});
