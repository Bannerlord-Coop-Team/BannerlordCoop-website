// Real isolated PostgreSQL tests. WEBSITE_MEMBERSHIP_TEST_URL is fixture-only;
// no deployed database or Supabase credentials are read by this suite.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
const url = process.env.WEBSITE_MEMBERSHIP_TEST_URL;
const migration = "supabase/migrations/202609080002_membership_onboarding.sql";
async function retryContention<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt=0; ; attempt++) {
        try { return await run(); } catch (error) {
            if (attempt>=20 || (error as {code?:string}).code!=="55P03") throw error;
            await new Promise(resolve=>setTimeout(resolve,10));
        }
    }
}
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
        await query("create schema auth; create table auth.users(id uuid primary key, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb, updated_at timestamptz); create role anon; create role authenticated; create role service_role;");
        await query(await readFile("supabase/migrations/20260907212654_create_patreon_links.sql", "utf8"));
        await query("insert into auth.users values($1),($2)", [a,b]);
        await query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,'1')",[a]);
        for (const name of ["20260907220000_patreon_website_roles.sql","20260907230000_atomic_live_console_assignments.sql"]) await query(await readFile(`supabase/migrations/${name}`,"utf8"));
        await query(await readFile(migration,"utf8"));
        await query(await readFile("supabase/migrations/202609080003_membership_role_locking.sql","utf8"));
        // Scenarios are independent delivery windows; preserve all receipts while
        // acknowledging prior scenario hints and advancing only fixture A/B clocks.
        t.beforeEach(async () => {
            const rows=(await query("select event_id from public.membership_outbox where receipt_id is null order by sequence")).rows;
            for(const row of rows) await rpc("membership_ack",[row.event_id,crypto.randomUUID()]);
            await query("update public.membership_heads set mutation_window_started_at=clock_timestamp()-interval '11 minutes' where account_id in ($1,$2)",[a,b]);
        });
        await t.test("populated identity-only history stays unverified and all new tables deny browser reads", async () => {
            const h = await rpc("membership_fence", [a,discord,false]); assert.equal(h.verification,"unverified"); assert.equal(h.linkGeneration,"2");
            for (const table of ["membership_heads","membership_outbox","membership_completion_receipts","discord_link_requests","membership_recovery_intents"]) {
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
            const prior = await rpc("membership_recovery",[account,discord,"patreon"]);
            if (prior.operationId) await rpc("membership_recovery",[account,discord,"patreon",prior.operationId,true]);
            const h = await rpc("membership_fence",[account,discord,false]);
            await query("insert into public.patreon_oauth_states(token_hash,kind,user_id,patreon_user_id,expires_at,operation_id,expected_generation,return_path,evidence) values($1,'complete',$2,$3,clock_timestamp()+($4::text)::interval,gen_random_uuid(),$5,'/servers',$6)",[token,account,patreon,expired ? "-1 minute" : "10 minutes",h.linkGeneration,evidence]);
            return token;
        }
        await t.test("redundant unlink is a stable retry but still fences a live pending generation", async () => {
            const first = await rpc("membership_unlink",[b,discord]);
            const rows = (await query("select count(*) from public.membership_outbox where account_id=$1",[b])).rows[0].count;
            assert.deepEqual(await rpc("membership_unlink",[b,discord]),first);
            assert.equal((await query("select count(*) from public.membership_outbox where account_id=$1",[b])).rows[0].count,rows);
        });
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
                const results = await Promise.all([rpc("membership_complete",[a,discord,token!]),retryContention(()=>peer.query("select public.membership_complete($1,$2,$3) result",[a,discord,token!])).then(r=>r.rows[0].result)]);
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
            await rpc("membership_fence",[a,"999456789012345678",false]);
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
            await rpc("membership_discord_callback",[b,token,discord]);
            const result = await rpc("membership_discord_confirm",[b,token,discord]); assert.deepEqual(await rpc("membership_discord_confirm",[b,token,discord]),result);
            await assert.rejects(rpc("membership_discord_confirm",[b,token,"999456789012345678"]));
            await query("update public.discord_link_requests set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",[token]); await assert.rejects(rpc("membership_discord_check",[b,token]));
        });
        await t.test("outbox commit ordering cannot skip a lower uncommitted sequence", async () => {
            const peer = new pg.Client({ connectionString: url }); await peer.connect();
            try {
                await stage(b,"7".repeat(64),"7"); // real authority, not a now-redundant unlink
                const before = await rpc("membership_changes",[null,50]);
                await query("begin"); await rpc("membership_unlink",[b,discord]);
                await assert.rejects(peer.query("select public.membership_fence($1,$2,false)",[b,"999456789012345678"]),{code:"55P03"});
                await query("commit"); await peer.query("select public.membership_fence($1,$2,false)",[b,"999456789012345678"]);
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
            const prior=await rpc("membership_recovery",[b,discord,"patreon"]);
            if(prior.operationId) await rpc("membership_recovery",[b,discord,"patreon",prior.operationId,true]);
            await rpc("membership_begin",[b,discord,"12345678-1111-4111-8111-111111111111","1".repeat(64),"/servers"]);
            await query("update public.patreon_oauth_states set kind='complete',patreon_user_id='7',evidence=$1 where token_hash=$2",[evidence,"1".repeat(64)]);
            await rpc("membership_begin",[b,discord,"22345678-1111-4111-8111-111111111111","2".repeat(64),"/servers"]);
            assert.equal((await rpc("membership_status",[b,discord])).verificationPending,true);
            await query("update public.patreon_oauth_states set kind='complete',patreon_user_id='7',evidence=$1 where token_hash=$2",[{...evidence,verification:"nonqualifying"},"2".repeat(64)]);
            await rpc("membership_complete",[b,discord,"2".repeat(64)]);
            await assert.rejects(rpc("membership_complete",[b,discord,"1".repeat(64)]));
            const status = await rpc("membership_status",[b,discord]); assert.equal(status.snapshot.verification,"nonqualifying"); assert.equal(status.verificationPending,false);
        });
        async function freshAccount() {
            const id = crypto.randomUUID(); await query("insert into auth.users values($1)",[id]);
            await rpc("membership_fence",[id,null,false]); return id;
        }
        async function beginFor(id: string, db = client) {
            return db.query("select public.membership_begin($1,null,$2,$3,'/servers') result",[id,crypto.randomUUID(),crypto.randomUUID().replaceAll("-", "").repeat(2)]);
        }
        async function drain(id: string) {
            // Real acknowledgements retain immutable rows/receipts, not fixture deletion.
            for (let i=0; i<20; i++) {
                const rows = (await query("select event_id from public.membership_outbox where account_id=$1 and receipt_id is null order by sequence",[id])).rows;
                if (!rows.length) return;
                for (const row of rows) await rpc("membership_ack",[row.event_id,crypto.randomUUID()]);
            }
            assert.fail("drain must terminate");
        }
        async function pendingCount(id: string) { return Number((await query("select count(*) from public.membership_outbox where account_id=$1 and receipt_id is null",[id])).rows[0].count); }
        await t.test("per-account fixed-window mutation admission is durable and concurrent; replay and other accounts progress", async () => {
            const id = await freshAccount();
            // Delivery keeps outbox capacity available, isolating the durable rate bound.
            for (let i=0; i<9; i++) { await beginFor(id); await drain(id); }
            const peers = await Promise.all(Array.from({length:4},async()=>{ const c=new pg.Client({connectionString:url}); await c.connect(); return c; }));
            try {
                const results = await Promise.allSettled(peers.map(c=>retryContention(()=>beginFor(id,c))));
                assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
                for (const result of results) if (result.status==="rejected") assert.equal(result.reason.code,"PT429");
            } finally { await Promise.all(peers.map(c=>c.end())); }
            assert.equal((await query("select mutation_count from public.membership_heads where account_id=$1",[id])).rows[0].mutation_count,10);
            await assert.rejects(beginFor(id),{code:"PT429"});
            const other = await freshAccount(); await beginFor(other); assert.equal(await pendingCount(other),1);
            // Conservative whole-window retry; expiry resets only this account's durable row.
            await query("update public.membership_heads set mutation_window_started_at=clock_timestamp()-interval '10 minutes' where account_id=$1",[id]);
            await beginFor(id);
            assert.equal((await query("select mutation_count from public.membership_heads where account_id=$1",[id])).rows[0].mutation_count,1);
        });
        await t.test("concurrent completions share durable budget, exact receipts replay at budget and unlink still revokes", async () => {
            const id=await freshAccount();
            const initial=await stage(id,"3".repeat(64),"987655"); await rpc("membership_complete",[id,discord,initial]);
            const completed=await rpc("membership_recovery",[id,discord,"patreon"]); await rpc("membership_recovery",[id,discord,"patreon",completed.operationId,true]); await drain(id);
            for(let i=0;i<8;i++) { await rpc("membership_begin",[id,discord,crypto.randomUUID(),crypto.randomUUID().replaceAll("-", "").repeat(2),"/servers"]); await drain(id); }
            // One recovery slot per provider blocks uncertain replacement. Two
            // concurrent calls of the exact last-admitted operation return one receipt.
            const x=await stage(id,"4".repeat(64),"987655");
            const peer=new pg.Client({connectionString:url}); await peer.connect();
            let result;
            try {
                const results=await Promise.all([retryContention(()=>rpc("membership_complete",[id,discord,x])),retryContention(()=>peer.query("select public.membership_complete($1,$2,$3) result",[id,discord,x])).then(r=>r.rows[0].result)]);
                assert.deepEqual(results[0],results[1]); result=results[0];
            } finally { await peer.end(); }
            assert.equal((await query("select mutation_count from public.membership_heads where account_id=$1",[id])).rows[0].mutation_count,10);
            const revoked=await rpc("membership_unlink",[id,discord]);
            assert.deepEqual(await rpc("membership_complete",[id,discord,x]),result);
            assert.deepEqual(await rpc("membership_unlink",[id,discord]),revoked);
            assert.equal((await rpc("membership_fence",[id,discord,false])).patreonUserId,null);
            assert.equal((await query("select mutation_count from public.membership_heads where account_id=$1",[id])).rows[0].mutation_count,10);
        });
        await t.test("four live authorities cap concurrent Discord/Patreon issuance and callback replacement cannot resurrect unlink", async () => {
            const id = await freshAccount();
            const peers = await Promise.all(Array.from({length:6},async()=>{ const c=new pg.Client({connectionString:url}); await c.connect(); return c; }));
            try {
                const results = await Promise.allSettled(peers.map(c=>{ const args=[id,crypto.randomUUID().replaceAll("-", "").repeat(2),crypto.randomUUID()]; return retryContention(()=>c.query("select public.membership_discord_begin($1,$2,$3,'/servers')",args)); }));
                assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
                for (const result of results) if(result.status==="rejected") assert.match(result.reason.message,/Resolve previous operation/);
            } finally { await Promise.all(peers.map(c=>c.end())); }
            const h=await rpc("membership_fence",[id,null,false]);
            for(let i=0;i<3;i++) await query("insert into public.patreon_oauth_states(token_hash,kind,user_id,expires_at,operation_id,expected_generation,return_path) values($1,'state',$2,clock_timestamp()+interval '10 minutes',$3,$4,'/servers')",[crypto.randomUUID().replaceAll("-", "").repeat(2),id,crypto.randomUUID(),h.linkGeneration]);
            await assert.rejects(beginFor(id),{code:"PT429"});
            await query("update public.patreon_oauth_states set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",[id]);
            await query("update public.discord_link_requests set expires_at=clock_timestamp()-interval '1 second' where account_id=$1",[id]);
            await beginFor(id);
            const state = (await query("delete from public.patreon_oauth_states where user_id=$1 returning *",[id])).rows[0];
            // OAuth is outside SQL while its consumed row is absent. Unknown evidence
            // still fences that generation; INSERT's trigger rejects late replacement.
            const revoked = await rpc("membership_unlink",[id,null]);
            await assert.rejects(query("insert into public.patreon_oauth_states(token_hash,kind,user_id,expires_at,operation_id,expected_generation,return_path) values($1,'state',$2,clock_timestamp()+interval '10 minutes',$3,$4,'/servers')",[state.token_hash,id,state.operation_id,state.expected_generation]),/Link generation changed/);
            assert.deepEqual(await rpc("membership_unlink",[id,null]),revoked);
        });
        await t.test("full ordinary queue reserves unlink capacity; full reserved queue defers newest revocation until atomic ack repair", async () => {
            const id = await freshAccount();
            for(let i=0;i<8;i++) await beginFor(id);
            assert.equal(await pendingCount(id),8); await assert.rejects(beginFor(id),{code:"PT429"});
            const fetched = (await query("select * from public.membership_outbox where account_id=$1 order by sequence",[id])).rows;
            const token = (await query("select token_hash from public.patreon_oauth_states where user_id=$1 order by expected_generation desc limit 1",[id])).rows[0].token_hash;
            await query("update public.patreon_oauth_states set kind='complete',patreon_user_id='987654',evidence=$1 where token_hash=$2",[evidence,token]);
            await assert.rejects(rpc("membership_complete",[id,null,token]),{code:"PT429"});
            assert.equal((await query("select count(*) from public.patreon_oauth_states where token_hash=$1",[token])).rows[0].count,"1");
            const pre = await rpc("membership_fence",[id,null,false]);
            await query("begin"); await rpc("membership_unlink",[id,null]); await query("rollback");
            assert.deepEqual(await rpc("membership_fence",[id,null,false]),pre); assert.equal(await pendingCount(id),8);
            const unlink = await rpc("membership_unlink",[id,null]); assert.equal(await pendingCount(id),9);
            assert.deepEqual(await rpc("membership_unlink",[id,null]),unlink); assert.equal(await pendingCount(id),9);
            await assert.rejects(rpc("membership_complete",[id,null,token]));
            // Previously fetched old hint, now with a newer head beyond all 9 hints.
            const head = await rpc("membership_fence",[id,discord,false]);
            assert.ok(BigInt(head.revision)>BigInt(unlink.revision)); assert.equal(await pendingCount(id),9);
            const old = fetched[0], receipt=crypto.randomUUID();
            await query("create function public.test_fail_successor() returns trigger language plpgsql as $$ begin raise exception 'injected successor failure'; end $$; create trigger test_fail_successor before insert on public.membership_outbox for each row execute function public.test_fail_successor()");
            await assert.rejects(rpc("membership_ack",[old.event_id,receipt]),/injected successor failure/);
            assert.equal((await query("select receipt_id from public.membership_outbox where event_id=$1",[old.event_id])).rows[0].receipt_id,null);
            await query("drop trigger test_fail_successor on public.membership_outbox; drop function public.test_fail_successor()");
            await query("begin"); await rpc("membership_ack",[old.event_id,receipt]); await query("rollback");
            assert.equal((await query("select receipt_id from public.membership_outbox where event_id=$1",[old.event_id])).rows[0].receipt_id,null);
            const ack = await rpc("membership_ack",[old.event_id,receipt]);
            assert.equal(await pendingCount(id),9);
            const successor = (await query("select * from public.membership_outbox where account_id=$1 and revision=$2",[id,head.revision])).rows[0];
            assert.ok(BigInt(successor.sequence)>BigInt(fetched.at(-1).sequence));
            assert.deepEqual(await rpc("membership_ack",[old.event_id,receipt]),ack);
            await assert.rejects(rpc("membership_ack",[old.event_id,crypto.randomUUID()]));
            assert.equal(await pendingCount(id),9);
            // A restarted connection replays exactly, then out-of-order ACK cannot
            // duplicate the newest-head event or erase its revocation.
            const peer=new pg.Client({connectionString:url}); await peer.connect();
            try { assert.deepEqual((await peer.query("select public.membership_ack($1,$2) result",[old.event_id,receipt])).rows[0].result,ack); }
            finally { await peer.end(); }
            await rpc("membership_ack",[successor.event_id,crypto.randomUUID()]);
            await rpc("membership_ack",[fetched[1].event_id,crypto.randomUUID()]);
            assert.equal((await query("select count(*) from public.membership_outbox where account_id=$1 and revision=$2",[id,head.revision])).rows[0].count,"1");
            await drain(id); assert.equal(await pendingCount(id),0);
            assert.equal((await rpc("membership_fence",[id,discord,false])).verification,"unverified");
        });
        await t.test("full-queue Auth deletion and concurrent ack/unlink/begin preserve bounded durable wake and cross-account progress", async () => {
            const id=await freshAccount(); for(let i=0;i<8;i++) await beginFor(id);
            await rpc("membership_unlink",[id,null]); assert.equal(await pendingCount(id),9);
            const event=(await query("select event_id from public.membership_outbox where account_id=$1 order by sequence limit 1",[id])).rows[0].event_id;
            const peer=new pg.Client({connectionString:url}); await peer.connect();
            try {
                const ack=crypto.randomUUID(); const results=await Promise.allSettled([retryContention(()=>rpc("membership_ack",[event,ack])),retryContention(()=>peer.query("select public.membership_unlink($1,null)",[id])),beginFor(id)]);
                assert.equal(results[0].status,"fulfilled"); assert.equal(results[1].status,"fulfilled");
                assert.ok(await pendingCount(id)<=9);
            } finally { await peer.end(); }
            // Fill reserved capacity using actual authority fences, then delete Auth.
            for(let i=0;i<12;i++) await rpc("membership_fence",[id,i%2 ? discord : "999456789012345678",false]);
            assert.equal(await pendingCount(id),9);
            await query("delete from auth.users where id=$1",[id]);
            const tombstone=await rpc("membership_fence",[id,null,true]);
            assert.equal(tombstone.linkState,"account_deleted"); assert.equal(await pendingCount(id),9);
            const other=await freshAccount(); await beginFor(other);
            assert.ok((await rpc("membership_changes",[null,50])).events.some((e:{accountId:string})=>e.accountId===other));
            await drain(id); assert.equal(await pendingCount(id),0);
            assert.deepEqual(await rpc("membership_fence",[id,null,true]),tombstone);
            await assert.rejects(beginFor(id),/Deleted account/);
            const latest=(await query("select receipt_id from public.membership_outbox where account_id=$1 and revision=$2",[id,tombstone.revision])).rows[0];
            assert.ok(latest.receipt_id);
        });
        await t.test("Discord callback receipt is server-only, exact-account, bounded and required before confirmation", async () => {
            const id=await freshAccount(), op=crypto.randomUUID(), tok="0a".repeat(32);
            await rpc("membership_discord_begin",[id,tok,op,"/servers"]);
            await assert.rejects(rpc("membership_discord_confirm",[id,tok,discord]),/callback authority/);
            assert.equal((await rpc("membership_recovery",[id,null,"discord",null,false,tok])).confirmable,false);
            for(const role of ["anon","authenticated"]) {
                await query(`set role ${role}`);
                try { await assert.rejects(rpc("membership_discord_callback",[id,tok,discord]),/permission denied/); await assert.rejects(rpc("membership_recovery",[id,discord,"discord"]),/permission denied/); }
                finally { await query("reset role"); }
            }
            await query("set role service_role");
            try {
                await assert.rejects(rpc("membership_discord_callback",[b,tok,discord]),/Invalid callback/);
                assert.equal((await rpc("membership_discord_callback",[id,tok,discord])).verified,true);
                assert.equal((await rpc("membership_discord_callback",[id,tok,discord])).verified,true);
                await assert.rejects(rpc("membership_discord_callback",[id,tok,"999456789012345678"]),/Callback conflict/);
            } finally { await query("reset role"); }
            assert.equal((await rpc("membership_recovery",[id,discord,"discord",null,false,tok])).confirmable,true);
            assert.equal((await rpc("membership_recovery",[id,discord,"discord"])).confirmable,false,"UUID/status cannot replace lost cookie authority");
            await rpc("membership_recovery",[id,discord,"discord",op,true]);
            await assert.rejects(rpc("membership_discord_callback",[id,tok,discord]));
            await assert.rejects(rpc("membership_discord_confirm",[id,tok,discord]));
        });
        await t.test("Discord clock boundaries, full window/outbox, expired cookie reference and post-expiry lost-response receipt", async () => {
            const id=await freshAccount(), tok="0b".repeat(32), op=crypto.randomUUID();
            // Seven ordinary hints, then callback's identity fence fills the eighth.
            // Do not supersede the Discord initiation generation to build pressure.
            for(let i=0;i<7;i++) await beginFor(id);
            await rpc("membership_discord_begin",[id,tok,op,"/servers"]);
            await rpc("membership_discord_callback",[id,tok,discord]);
            await query("update public.membership_heads set mutation_count=10 where account_id=$1",[id]);
            await assert.rejects(rpc("membership_discord_confirm",[id,tok,discord]),{code:"PT429"});
            const before=await rpc("membership_recovery",[id,discord,"discord",null,false,tok]); assert.equal(before.state,"live");
            // Production <= clock_timestamp boundary, checked with equal timestamps on PG.
            const boundary=(await query("select public.membership_authority_live(expires_at,expires_at) as at_expiry, public.membership_authority_live(expires_at,expires_at - interval '1 microsecond') as before_expiry, public.membership_authority_live(expires_at,expires_at + interval '1 microsecond') as after_expiry from public.discord_link_requests where token_hash=$1",[tok])).rows[0];
            assert.deepEqual(boundary,{at_expiry:false,before_expiry:true,after_expiry:false});
            await query("update public.discord_link_requests set expires_at=clock_timestamp() where token_hash=$1",[tok]);
            await query("update public.membership_recovery_intents set expires_at=clock_timestamp() where operation_id=$1",[op]);
            await assert.rejects(rpc("membership_discord_confirm",[id,tok,discord]),/callback authority/);
            assert.equal((await rpc("membership_recovery",[id,discord,"discord"])).state,"expired");
            await query("update public.discord_link_requests set expires_at=clock_timestamp()-interval '600 seconds' where token_hash=$1",[tok]);
            await assert.rejects(rpc("membership_discord_confirm",[id,tok,discord]));
            assert.equal((await rpc("membership_recovery",[b,discord,"discord",op,true])).state,"none");
            assert.equal((await rpc("membership_recovery",[id,discord,"discord",op,true])).state,"cancelled");
            await assert.rejects(rpc("membership_discord_callback",[id,tok,discord]));
            // A separate actually committed operation recovers after expiry at full budget.
            const owner=await freshAccount(), committedToken="0c".repeat(32), committedOp=crypto.randomUUID();
            await rpc("membership_discord_begin",[owner,committedToken,committedOp,"/servers"]); await rpc("membership_discord_callback",[owner,committedToken,discord]);
            const result=await rpc("membership_discord_confirm",[owner,committedToken,discord]);
            const row=(await query("select * from public.discord_link_requests where token_hash=$1",[committedToken])).rows[0];
            await query("update public.discord_link_requests set expires_at=clock_timestamp()-interval '11 minutes' where token_hash=$1",[committedToken]);
            await query("update public.membership_heads set mutation_count=10 where account_id=$1",[owner]);
            assert.deepEqual(await rpc("membership_discord_confirm",[owner,committedToken,discord]),result);
            assert.equal((await query("select confirmed_at from public.discord_link_requests where token_hash=$1",[committedToken])).rows[0].confirmed_at.toISOString(),row.confirmed_at.toISOString());
            const restarted=new pg.Client({connectionString:url}); await restarted.connect();
            try { assert.equal((await restarted.query("select public.membership_recovery($1,$2,'discord') r",[owner,discord])).rows[0].r.state,"committed"); }
            finally { await restarted.end(); }
            await assert.rejects(rpc("membership_discord_confirm",[b,committedToken,discord]));
            assert.equal((await rpc("membership_recovery",[owner,"999456789012345678","discord",committedOp,true])).state,"retired");
            assert.equal((await rpc("membership_recovery",[owner,discord,"discord",committedOp,true])).state,"committed");
            assert.deepEqual(await rpc("membership_discord_confirm",[owner,committedToken,discord]),result);
        });
        await t.test("historical Discord slot retirement after Auth unlink/change preserves history and permits exact restart", async () => {
            for (const acknowledged of [false,true]) for (const current of [null,"999456789012345678"]) {
                const id=await freshAccount(), tok=crypto.randomUUID().replaceAll("-", "").repeat(2), op=crypto.randomUUID();
                await rpc("membership_discord_begin",[id,tok,op,"/servers"]);
                await rpc("membership_discord_callback",[id,tok,discord]);
                const original=await rpc("membership_discord_confirm",[id,tok,discord]);
                if(acknowledged) await rpc("membership_recovery",[id,discord,"discord",op,true]);
                const history=(await query("select * from public.discord_link_requests where token_hash=$1",[tok])).rows;
                // Auth is authoritative input from the handler, not an identity restored by recovery.
                await rpc("membership_status",[id,current]);
                const head=(await query("select * from public.membership_heads where account_id=$1",[id])).rows;
                const hints=(await query("select * from public.membership_outbox where account_id=$1 order by sequence",[id])).rows;
                await assert.rejects(rpc("membership_discord_confirm",[id,tok,current]),/Discord linking conflict/);
                const stale=await rpc("membership_recovery",[id,current,"discord"]);
                assert.equal(stale.state,acknowledged ? "retired" : "historical"); assert.equal(stale.receipt,null); assert.equal(stale.confirmable,false);
                if(!acknowledged && current===null) await assert.rejects(rpc("membership_discord_begin",[id,"8a".repeat(32),crypto.randomUUID(),"/account"]),/Resolve previous operation/);
                assert.equal((await rpc("membership_recovery",[b,current,"discord",op,true])).state,"none");
                assert.equal((await rpc("membership_recovery",[id,current,"discord",crypto.randomUUID(),true])).state,"none");
                const retired=await rpc("membership_recovery",[id,current,"discord",op,true]);
                assert.equal(retired.state,"retired"); assert.equal(retired.receipt,null);
                const restart=new pg.Client({connectionString:url}); await restart.connect();
                try {
                    // Lost retirement response, cookie-free reload and exact retry from a new connection.
                    assert.deepEqual((await restart.query("select public.membership_recovery($1,$2,'discord',$3,true) r",[id,current,op])).rows[0].r,retired);
                    assert.equal((await restart.query("select public.membership_recovery($1,$2,'discord') r",[id,current])).rows[0].r.state,"retired");
                } finally { await restart.end(); }
                assert.deepEqual((await query("select * from public.membership_heads where account_id=$1",[id])).rows,head);
                assert.deepEqual((await query("select * from public.membership_outbox where account_id=$1 order by sequence",[id])).rows,hints);
                assert.deepEqual((await query("select * from public.discord_link_requests where token_hash=$1",[tok])).rows,history);
                if(current===null) {
                    const next=crypto.randomUUID(); await rpc("membership_discord_begin",[id,crypto.randomUUID().replaceAll("-", "").repeat(2),next,"/account"]);
                    assert.equal((await rpc("membership_recovery",[id,null,"discord",op,true])).state,"none");
                    const pending=await rpc("membership_recovery",[id,null,"discord"]); assert.equal(pending.operationId,next); assert.equal(pending.state,"live");
                } else assert.equal((await rpc("membership_status",[id,current])).snapshot.discordUserId,current);
                assert.deepEqual((await query("select * from public.discord_link_requests where token_hash=$1",[tok])).rows,history);
                // Already committed replay keeps its original bytes when Auth really matches again.
                assert.deepEqual(await rpc("membership_discord_confirm",[id,tok,discord]),original);
            }
        });
        await t.test("Discord deadline crossing inside admission or final write rolls back the entire RPC", async () => {
            for (const window of ["cleanup", "final_write"]) {
                const id=await freshAccount(), tok=crypto.randomUUID().replaceAll("-", "").repeat(2), op=crypto.randomUUID();
                await rpc("membership_discord_begin",[id,tok,op,"/servers"]); await rpc("membership_discord_callback",[id,tok,discord]);
                // Fixture-only trigger waits across the actual stored deadline inside the RPC.
                await query(`create function public.test_deadline_wait() returns trigger language plpgsql as $$ declare deadline timestamptz; begin
                    select expires_at into deadline from public.discord_link_requests where account_id=new.account_id and confirmed_at is null;
                    if deadline is not null then perform pg_sleep(greatest(0,extract(epoch from deadline-clock_timestamp()))+0.02); end if;
                    return new; end $$`);
                // The window-reset update is after the initial authority check but before cleanup.
                // The increment update instead covers expiry after cleanup retained the row.
                await query("update public.membership_heads set mutation_window_started_at=clock_timestamp()-interval '11 minutes' where account_id=$1",[id]);
                await query(window==="cleanup"
                    ? "create trigger test_deadline_wait before update of mutation_window_started_at on public.membership_heads for each row execute function public.test_deadline_wait()"
                    : "create trigger test_deadline_wait before update of mutation_count on public.membership_heads for each row when (new.mutation_count > 0) execute function public.test_deadline_wait()");
                try {
                    // Plenty of initial authority; trigger waits until the actual stored deadline.
                    await query("update public.discord_link_requests set expires_at=clock_timestamp()+interval '1 second' where token_hash=$1",[tok]);
                    const snapshot=async () => (await query(`select
                        (select jsonb_agg(to_jsonb(r)) from public.discord_link_requests r where account_id=$1) requests,
                        (select to_jsonb(h) from public.membership_heads h where account_id=$1) head,
                        (select jsonb_agg(to_jsonb(o) order by sequence) from public.membership_outbox o where account_id=$1) outbox,
                        (select jsonb_agg(to_jsonb(i)) from public.membership_recovery_intents i where account_id=$1) intents,
                        (select jsonb_agg(to_jsonb(c)) from public.membership_completion_receipts c where account_id=$1) receipts`,[id])).rows[0];
                    const before=await snapshot();
                    let result: unknown; let failure: unknown;
                    try { result=await rpc("membership_discord_confirm",[id,tok,discord]); } catch(error) { failure=error; }
                    const after=await snapshot();
                    console.log("INTRA_RPC_DEADLINE",JSON.stringify({window,result:result??null,error:failure instanceof Error ? failure.message : null,requestsAfter:after.requests,rolledBack:JSON.stringify(after)===JSON.stringify(before)}));
                    assert.match(failure instanceof Error ? failure.message : "unexpected success",/Discord confirmation expired or missing/);
                    assert.deepEqual(after,before,"cleanup, admission, audit/outbox, authority and receipts all roll back");
                    assert.equal((await query("select confirmed_at from public.discord_link_requests where token_hash=$1",[tok])).rows[0].confirmed_at,null);
                } finally {
                    await query("drop trigger test_deadline_wait on public.membership_heads; drop function public.test_deadline_wait()");
                }
            }
        });
        await t.test("Patreon recovery survives expiry/deleted transport, unlink, response loss and serializes cancellation with completion", async () => {
            const id=await freshAccount(), tok=await stage(id,"0d".repeat(32),"555551");
            const pending=await rpc("membership_recovery",[id,discord,"patreon",null,false,tok]); assert.equal(pending.confirmable,true);
            await assert.rejects(beginFor(id),/Resolve previous operation/);
            const peer=new pg.Client({connectionString:url}); await peer.connect();
            try {
                await query("begin"); const result=await rpc("membership_complete",[id,discord,tok]);
                await assert.rejects(peer.query("select public.membership_recovery($1,$2,'patreon',$3,true) r",[id,discord,pending.operationId]),{code:"55P03"});
                await query("commit");
                const resolved=(await peer.query("select public.membership_recovery($1,$2,'patreon',$3,true) r",[id,discord,pending.operationId])).rows[0].r; assert.equal(resolved.state,"committed"); assert.deepEqual(resolved.receipt,result);
                await rpc("membership_unlink",[id,discord]); assert.deepEqual(await rpc("membership_complete",[id,discord,tok]),result);
                assert.equal((await rpc("membership_fence",[id,discord,false])).patreonUserId,null);
            } finally { await query("rollback"); await peer.end(); }
            const expired=await stage(id,"0e".repeat(32),"555551",true); const intent=await rpc("membership_recovery",[id,discord,"patreon"]); assert.equal(intent.state,"expired");
            await query("delete from public.patreon_oauth_states where token_hash=$1",[expired]);
            assert.equal((await rpc("membership_recovery",[id,discord,"patreon"])).state,"expired");
            assert.equal((await rpc("membership_recovery",[id,discord,"patreon",intent.operationId,true])).state,"cancelled");
            await assert.rejects(rpc("membership_complete",[id,discord,expired]));
            const cancelled=await stage(id,"0f".repeat(32),"555551"); const live=await rpc("membership_recovery",[id,discord,"patreon"]);
            await rpc("membership_recovery",[id,discord,"patreon",live.operationId,true]); await assert.rejects(rpc("membership_complete",[id,discord,cancelled]));
        });
        await t.test("initiation generation CAS refuses status/Patreon supersession without losing independent current Auth", async () => {
            for(const mutation of ["status", "begin", "unlink"]) {
                const id=await freshAccount(), tok=crypto.randomUUID().replaceAll("-", "").repeat(2), op=crypto.randomUUID();
                if(mutation==="unlink") await beginFor(id); // ensure unlink has real authority to fence
                await rpc("membership_discord_begin",[id,tok,op,"/servers"]);
                const peer=new pg.Client({connectionString:url}); await peer.connect();
                try {
                    await query("begin");
                    if(mutation==="status") await rpc("membership_status",[id,discord]);
                    else if(mutation==="begin") await beginFor(id);
                    else await rpc("membership_unlink",[id,null]);
                    const before=(await query("select * from public.membership_heads where account_id=$1",[id])).rows[0];
                    await assert.rejects(peer.query("select public.membership_discord_callback($1,$2,$3)",[id,tok,discord]),{code:"55P03"});
                    await query("commit"); await assert.rejects(peer.query("select public.membership_discord_callback($1,$2,$3)",[id,tok,discord]),/Callback superseded/);
                    assert.deepEqual((await query("select * from public.membership_heads where account_id=$1",[id])).rows[0],before,"refused stamp rolls back every effect");
                    assert.equal((await query("select callback_discord_id from public.discord_link_requests where token_hash=$1",[tok])).rows[0].callback_discord_id,null);
                    const pending=await rpc("membership_recovery",[id,discord,"discord",null,false,tok]); assert.equal(pending.state,"live"); assert.equal(pending.confirmable,false);
                    await rpc("membership_recovery",[id,discord,"discord",op,true]);
                    assert.equal((await rpc("membership_fence",[id,discord,false])).discordUserId,discord);
                } finally { await query("rollback"); await peer.end(); }
            }
            const id=await freshAccount(), tok="3a".repeat(32);
            await rpc("membership_discord_begin",[id,tok,crypto.randomUUID(),"/servers"]); await rpc("membership_discord_callback",[id,tok,discord]);
            assert.equal((await rpc("membership_discord_callback",[id,tok,discord])).verified,true);
            await beginFor(id);
            await assert.rejects(rpc("membership_discord_callback",[id,tok,discord]),/Callback conflict/);
            await assert.rejects(rpc("membership_discord_confirm",[id,tok,discord]),/callback authority/);
        });
        await t.test("Discord callback/cancel/confirm races serialize and resolved receipts survive a lost acknowledgment response", async () => {
            const id=await freshAccount(), tok="2a".repeat(32), op=crypto.randomUUID();
            await rpc("membership_discord_begin",[id,tok,op,"/servers"]);
            const peer=new pg.Client({connectionString:url}); await peer.connect();
            try {
                await query("begin"); await rpc("membership_recovery",[id,discord,"discord",op,true]);
                await assert.rejects(peer.query("select public.membership_discord_callback($1,$2,$3)",[id,tok,discord]),{code:"55P03"});
                await query("commit"); await assert.rejects(peer.query("select public.membership_discord_callback($1,$2,$3)",[id,tok,discord]),/Invalid callback/);
                assert.equal((await rpc("membership_recovery",[id,discord,"discord"])).state,"none");
                const next="2b".repeat(32), nextOp=crypto.randomUUID();
                await rpc("membership_discord_begin",[id,next,nextOp,"/servers"]); await rpc("membership_discord_callback",[id,next,discord]);
                await query("begin"); const receipt=await rpc("membership_discord_confirm",[id,next,discord]);
                const resolve=retryContention(()=>peer.query("select public.membership_recovery($1,$2,'discord',$3,true) r",[id,discord,nextOp]));
                await query("commit"); assert.deepEqual((await resolve).rows[0].r.receipt,receipt);
                // Simulated lost HTTP result: no cookie/UUID needed on the next reload.
                const reload=await rpc("membership_recovery",[id,discord,"discord"]); assert.equal(reload.state,"resolved"); assert.equal(reload.operationId,nextOp);
                assert.deepEqual((await rpc("membership_recovery",[id,discord,"discord",nextOp,true])).receipt,receipt);
                const count=(await query("select count(*) from public.discord_link_requests where account_id=$1 and confirmed_at is not null",[id])).rows[0].count;
                await rpc("membership_discord_begin",[id,"2c".repeat(32),crypto.randomUUID(),"/account"]);
                assert.equal((await query("select count(*) from public.discord_link_requests where account_id=$1 and confirmed_at is not null",[id])).rows[0].count,count);
            } finally { await query("rollback"); await peer.end(); }
        });
        await t.test("pending Discord admission uses partial account/expiry index with populated retained history", async () => {
            const id=await freshAccount(), other=await freshAccount();
            await query("insert into public.discord_link_requests(token_hash,operation_id,account_id,return_path,expires_at,confirmed_discord_id,confirmed_at) select encode(sha256(convert_to('history-'||g::text,'UTF8')),'hex'),gen_random_uuid(),case when g%2=0 then $1::uuid else $2::uuid end,'/servers',clock_timestamp()-interval '1 day',$3,clock_timestamp() from generate_series(1,50000) g",[id,other,discord]);
            await rpc("membership_discord_begin",[id,"1a".repeat(32),crypto.randomUUID(),"/servers"]);
            await query("analyze public.discord_link_requests");
            for(const sql of ["select count(*) from public.discord_link_requests where account_id=$1 and confirmed_at is null", "select count(*) from public.discord_link_requests where account_id=$1 and confirmed_at is null and expires_at>clock_timestamp()", "delete from public.discord_link_requests where account_id=$1 and confirmed_at is null and expires_at<=clock_timestamp()"]) {
                const plan=(await query(`explain (analyze, buffers, format json) ${sql}`,[id])).rows[0]["QUERY PLAN"];
                console.log("POPULATED_HISTORY_PLAN",JSON.stringify(plan));
                assert.match(JSON.stringify(plan),/discord_link_requests_pending_account_expiry/);
                assert.doesNotMatch(JSON.stringify(plan),/"Node Type":"Seq Scan"/);
            }
            assert.equal((await query("select count(*) from public.discord_link_requests where account_id in ($1,$2) and confirmed_at is not null",[id,other])).rows[0].count,"50000");
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
