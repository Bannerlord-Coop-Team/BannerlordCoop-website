// Combined PR104 + onboarding against actual isolated PostgreSQL. No live credentials.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
const url = process.env.WEBSITE_MEMBERSHIP_LOCK_TEST_URL;
const baseline = process.env.WEBSITE_MEMBERSHIP_BASELINE === "1";
const a = "aaaaaaaa-1111-4111-8111-111111111111", b = "bbbbbbbb-1111-4111-8111-111111111111";
const member = "cccccccc-1111-4111-8111-111111111111";
const tables = ["auth.users", "public.patreon_accounts", "public.patreon_oauth_states", "public.membership_heads", "public.membership_outbox", "public.membership_completion_receipts", "public.membership_recovery_intents", "public.discord_link_requests", "patreon_roles.sync_state", "patreon_roles.memberships", "patreon_roles.grants", "patreon_roles.audit"];
test("membership role locking: actual PostgreSQL combined call graph", { skip: !url }, async t => {
    const target = new URL(url!); assert.equal(target.hostname,"127.0.0.1"); assert.equal(target.pathname,"/website_membership_lock_test");
    const db = new pg.Client({connectionString:url}); const peer = new pg.Client({connectionString:url}); const third = new pg.Client({connectionString:url});
    await Promise.all([db.connect(),peer.connect(),third.connect()]);
    const rpc = async (name:string,args:unknown[],c=db) => (await c.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) r`,args)).rows[0].r;
    const role = (op:string,input:object,c=db) => rpc("patreon_role_sync",["10","20",op,input],c);
    async function snapshot(c=db) { const result:Record<string,unknown>={}; for(const table of tables) result[table]=(await c.query(`select to_jsonb(t) r from ${table} t order by to_jsonb(t)::text`)).rows; return result; }
    async function refusal(run:()=>Promise<unknown>,label:string) {
        const before=await snapshot(); const start=Date.now();
        await assert.rejects(run(),{code:"55P03"},label); assert.ok(Date.now()-start<1500,"bounded refusal, not deadlock timeout");
        assert.deepEqual(await snapshot(),before,"whole-statement rollback: "+label); console.log("REFUSAL_ROLLBACK",label);
    }
    async function setup() {
        await db.query("truncate public.membership_completion_receipts, public.membership_outbox, public.membership_recovery_intents, public.discord_link_requests, public.patreon_oauth_states, public.membership_heads, patreon_roles.audit, patreon_roles.grants, patreon_roles.memberships, patreon_roles.sync_state, public.patreon_accounts, auth.users cascade");
        await db.query("insert into auth.users(id,email_confirmed_at,raw_app_meta_data) values($1,now(),'{\"role\":\"User\",\"unrelated\":true}'),($2,now(),'{\"role\":\"User\"}')",[a,b]);
        await db.query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,'123')",[a]);
        await rpc("membership_fence",[a,null,false]); await rpc("membership_fence",[b,null,false]);
        await role("queue",{memberId:member}); const lease=await role("acquire",{});
        await role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:true});
        return lease;
    }
    async function stage(patreon="456",account=a) {
        const head=await rpc("membership_fence",[account,null,false]); const token=crypto.randomUUID().replaceAll("-","").repeat(2); const op=crypto.randomUUID();
        await db.query("insert into public.patreon_oauth_states(token_hash,kind,user_id,patreon_user_id,expires_at,operation_id,expected_generation,return_path,evidence) values($1,'complete',$2,$3,now()+interval '10 minutes',$4,$5,'/servers',public.membership_empty_evidence())",[token,account,patreon,op,head.linkGeneration]); return {token,op};
    }
    try {
        await db.query("create schema auth; create table auth.users(id uuid primary key, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb, updated_at timestamptz)");
        for(const name of ["20260907212654_create_patreon_links.sql","20260907220000_patreon_website_roles.sql","20260907230000_atomic_live_console_assignments.sql","202609080002_membership_onboarding.sql",...(!baseline?["202609080003_membership_role_locking.sql"]:[])]) await db.query(await readFile(`supabase/migrations/${name}`,"utf8"));
        // Harness safety deadline produces baseline red instead of hanging a cyclic test.
        for(const c of [db,peer,third]) await c.query("set statement_timeout='2s'; set lock_timeout='1700ms'");
        for(const operation of ["unlink","complete","replacement","worker","delete"] as const) await t.test(`${operation} refuses held Auth tuple, preserves all effects, explicit retry`,async()=>{
            const lease=await setup(); if(operation==="complete") await rpc("membership_unlink",[a,null]);
            const pending=["complete","replacement"].includes(operation)?await stage():null;
            const run=()=>operation==="worker"?role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:false}):operation==="delete"?db.query("delete from auth.users where id=$1",[a]):pending?rpc("membership_complete",[a,null,pending.token]):rpc("membership_unlink",[a,null]);
            await peer.query("begin"); await peer.query("select 1 from auth.users where id=$1 for update",[a]);
            try {
                if(operation==="delete") {
                    // DELETE's initial executor lock is outside trigger-local timeout;
                    // verify it separately through a held participating global below.
                    await assert.rejects(run(),{code:"55P03"});
                } else await refusal(run,operation+" / Auth");
            } finally { await peer.query("rollback"); }
            const result=await run();
            if(pending) { assert.equal(result.operationId,pending.op); assert.deepEqual(await run(),result,"lost response returns exact receipt without reapplying"); }
            assert.equal((await db.query("show lock_timeout")).rows[0].lock_timeout,"1700ms");
        });
        await t.test("worker versus unlink, complete, replacement and delete in both global-first orders",async()=>{
            for(const op of ["unlink","complete","replacement","delete"]) for(const workerFirst of [false,true]) {
                const lease=await setup(); if(op==="complete") await rpc("membership_unlink",[a,null]); const pending=["complete","replacement"].includes(op)?await stage():null;
                const mutation=(c:pg.Client)=>op==="delete"?c.query("delete from auth.users where id=$1",[a]):pending?rpc("membership_complete",[a,null,pending.token],c):rpc("membership_unlink",[a,null],c);
                const worker=(c:pg.Client)=>role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:false},c);
                await peer.query("begin");
                try {
                    await (workerFirst?worker(peer):mutation(peer));
                    if(op==="delete"&&workerFirst) {
                        const pid=(await db.query("select pg_backend_pid() pid")).rows[0].pid;
                        const pending=mutation(db);
                        for(let i=0;i<100;i++) {if((await third.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0].wait_event_type==="Lock")break;if(i===99)assert.fail("pre-trigger Auth wait not reached");await new Promise(r=>setTimeout(r,5));}
                        assert.notEqual((await third.query("select link_state from public.membership_heads where account_id=$1",[a])).rows[0].link_state,"account_deleted");
                        await peer.query("commit"); await pending;
                        console.log("PRE_TRIGGER_WAIT", "worker commits independently, then Auth deletion completes");
                    } else await refusal(()=>workerFirst?mutation(db):worker(db),`${op} / workerFirst=${workerFirst}`);
                }
                finally { await peer.query("commit"); }
                await (workerFirst?mutation(db):worker(db));
                if(op==="delete") assert.equal((await rpc("membership_fence",[a,null,true])).linkState,"account_deleted");
            }
        });
        await t.test("legacy Patreon tuple/global inversion and singleton bootstrap refusal",async()=>{
            await setup(); await peer.query("begin"); await peer.query("select 1 from public.patreon_accounts where user_id=$1 for update",[a]);
            try { await refusal(()=>rpc("membership_unlink",[a,null]),"global -> legacy Patreon tuple"); }
            finally { await peer.query("rollback"); }
            await db.query("begin"); await rpc("membership_fence",[a,null,false]);
            try { const before=await snapshot(third); await assert.rejects(peer.query("delete from public.patreon_accounts where user_id=$1",[a]),{code:"55P03"}); assert.deepEqual(await snapshot(third),before); }
            finally { await db.query("rollback"); }
            await db.query("truncate patreon_roles.sync_state"); await peer.query("begin"); await role("queue",{memberId:member},peer);
            try { await refusal(()=>role("queue",{memberId:crypto.randomUUID()}),"bootstrap insert / global"); }
            finally { await peer.query("rollback"); }
        });
        await t.test("three-way global -> singleton -> Auth -> global cycle refuses each cyclic edge",async()=>{
            const lease=await setup();
            await peer.query("begin"); await peer.query("select 1 from patreon_roles.sync_state for update");
            await third.query("begin"); await third.query("select 1 from auth.users where id=$1 for update",[a]);
            try {
                await refusal(()=>rpc("membership_unlink",[a,null]),"global -> singleton while Auth held");
                // Auth deletion already owns its row when its fence tries the global.
                await db.query("begin"); await rpc("membership_lock",[]);
                await assert.rejects(third.query("delete from auth.users where id=$1",[a]),{code:"55P03"});
                await db.query("rollback"); await third.query("rollback");
                await peer.query("rollback");
                await third.query("begin"); await third.query("select 1 from auth.users where id=$1 for update",[a]);
                await refusal(()=>role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:false}),"worker singleton -> Auth");
            } finally { await Promise.all([db.query("rollback"),peer.query("rollback"),third.query("rollback")]); }
            await role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:false});
            await rpc("membership_unlink",[a,null]); await db.query("delete from auth.users where id=$1",[a]);
        });
        await t.test("actual simultaneous three-way barriers abort a participant rather than deadlock",async()=>{
            const lease=await setup(); const before=await snapshot();
            await db.query("begin;select pg_advisory_xact_lock(702,1)");
            await peer.query("begin;select 1 from patreon_roles.sync_state for update");
            await third.query("begin");await third.query("select 1 from auth.users where id=$1 for update",[a]);
            try {
                const results=await Promise.allSettled([
                    rpc("membership_unlink",[a,null],db),
                    role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:false},peer),
                    third.query("delete from auth.users where id=$1",[a]),
                ]);
                const codes=results.map(r=>r.status==="rejected"?r.reason.code:"committed-in-transaction");
                console.log("THREE_WAY_BARRIER_RESULTS",JSON.stringify(codes));
                for(const r of results) if(r.status==="rejected") assert.equal(r.reason.code,"55P03");
                assert.ok(results.some(r=>r.status==="rejected"));
            }finally{await Promise.all([db.query("rollback"),peer.query("rollback"),third.query("rollback")]);}
            assert.deepEqual(await snapshot(),before,"all refused/abandoned transactions have zero effects");
            await role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:false});
            await rpc("membership_unlink",[a,null]);await db.query("delete from auth.users where id=$1",[a]);
        });
        await t.test("invisible unique insertion and FK waits hit local budget, not NOWAIT; timeout restored",async()=>{
            await setup(); const pending=await stage("789",b);
            // Insert's AFTER trigger is fixture-paused before our trigger by an advisory
            // barrier. Its uncommitted unique key is invisible to SELECT FOR UPDATE.
            await db.query("create function public.a_fixture_pause() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(991,1); return new; end $$; create trigger a_fixture_pause after insert on public.patreon_accounts for each row execute function public.a_fixture_pause()");
            const c=crypto.randomUUID(); await db.query("insert into auth.users(id,email_confirmed_at) values($1,now())",[c]);
            const pid=(await peer.query("select pg_backend_pid() pid")).rows[0].pid;
            await third.query("begin; select pg_advisory_xact_lock(991,1)");
            const blocked=peer.query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,'789')",[c]).then(()=>null,e=>e);
            try {
                for(let i=0;i<100;i++) { const wait=(await db.query("select wait_event from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event; if(wait==="advisory") break; if(i===99) assert.fail("barrier not reached"); await new Promise(r=>setTimeout(r,5)); }
                const start=Date.now(); await refusal(()=>rpc("membership_complete",[b,null,pending.token]),"invisible unique index"); assert.ok(Date.now()-start>=80);
            } finally { await third.query("rollback"); await blocked; await db.query("drop trigger a_fixture_pause on public.patreon_accounts; drop function public.a_fixture_pause()"); }
            // Competing committed identity remains unique; caller cannot steal it.
            await assert.rejects(rpc("membership_complete",[b,null,pending.token]),{code:"23505"});
            await db.query("delete from public.patreon_accounts where user_id=$1",[c]); await rpc("membership_complete",[b,null,pending.token]);
            // Callback insert FK wait occurs within membership_begin's function-local budget.
            const d=crypto.randomUUID(); await db.query("insert into auth.users(id) values($1)",[d]); await rpc("membership_fence",[d,null,false]);
            await peer.query("begin"); await peer.query("select 1 from auth.users where id=$1 for update",[d]);
            try { const start=Date.now(); await refusal(()=>rpc("membership_begin",[d,null,crypto.randomUUID(),"f".repeat(64),"/account"]),"invisible FK KEY SHARE"); assert.ok(Date.now()-start>=80); }
            finally { await peer.query("rollback"); }
            assert.equal((await db.query("show lock_timeout")).rows[0].lock_timeout,"1700ms");
            await rpc("membership_begin",[d,null,crypto.randomUUID(),"f".repeat(64),"/account"]);
            assert.equal((await db.query("show lock_timeout")).rows[0].lock_timeout,"1700ms");
        });
        await t.test("function GUC scopes retain tighter caller budgets and restore success, refusal and nested errors",async()=>{
            await setup();const id=crypto.randomUUID();await db.query("insert into auth.users(id) values($1)",[id]);await rpc("membership_fence",[id,null,false]);
            // A fixture-only trigger records the effective budget during the actual
            // nested callback insert, after the outer RPC and admission trigger.
            await db.query("create table public.fixture_budget(value text);create function public.z_fixture_budget() returns trigger language plpgsql as $$ begin insert into public.fixture_budget values(current_setting('lock_timeout'));return new;end $$;create trigger z_fixture_budget before insert on public.patreon_oauth_states for each row execute function public.z_fixture_budget()");
            try {for(const caller of ["0","10ms","100ms","1700ms"]) {
                await db.query("select set_config('lock_timeout',$1,false)",[caller]);
                const before=(await db.query("show lock_timeout")).rows[0].lock_timeout;
                const budget=caller==="10ms"?"10ms":"100ms";
                const args=[id,null,crypto.randomUUID(),crypto.randomUUID().replaceAll("-","").repeat(2),"/account"];
                await rpc("membership_begin",args);
                { const observed=(await db.query("select value from public.fixture_budget order by ctid desc limit 1")).rows[0].value;assert.equal(observed,budget); }
                assert.equal((await db.query("show lock_timeout")).rows[0].lock_timeout,before);
                await peer.query("begin");await peer.query("select 1 from auth.users where id=$1 for update",[id]);
                const start=Date.now();
                try {await db.query("begin;savepoint attempted");await assert.rejects(rpc("membership_begin",[id,null,crypto.randomUUID(),crypto.randomUUID().replaceAll("-","").repeat(2),"/account"]),{code:"55P03"});await db.query("rollback to attempted");assert.equal((await db.query("show lock_timeout")).rows[0].lock_timeout,before);await db.query("commit");}
                finally {await db.query("rollback");await peer.query("rollback");}
                const elapsed=Date.now()-start;assert.ok(elapsed<(caller==="10ms"?90:1000));assert.ok(elapsed>=(caller==="10ms"?5:80));
                assert.equal((await db.query("show lock_timeout")).rows[0].lock_timeout,before);
                await assert.rejects(rpc("set_member_role",[id,"invalid"]));assert.equal((await db.query("show lock_timeout")).rows[0].lock_timeout,before);
                console.log("FUNCTION_BUDGET_RESTORED",JSON.stringify({caller:before,effective:budget,elapsed}));
            }}finally{await db.query("set lock_timeout='1700ms';drop trigger z_fixture_budget on public.patreon_oauth_states;drop function public.z_fixture_budget();drop table public.fixture_budget");}
        });
        await t.test("link scan generations, independent manual Standard and console assignment preservation",async()=>{
            const lease=await setup();
            await rpc("set_live_console_assignment",[a,"old",null,true]); await rpc("set_member_role",[a,"Standard Server"]);
            await rpc("set_live_console_assignment",[a,"old",null,false]); await rpc("set_live_console_assignment",[a,"new",null,true]);
            await role("complete",{token:lease.token,memberId:member,generation:1,userId:"123",eligible:false});
            const metadata=(await db.query("select raw_app_meta_data m from auth.users where id=$1",[a])).rows[0].m;
            assert.equal(metadata.role,"Standard Server"); assert.deepEqual(metadata.live_console_operator_server_ids,["new"]); assert.equal(metadata.unrelated,true);
            await db.query("delete from public.patreon_accounts where user_id=$1",[a]);
            assert.deepEqual(await role("discovered",{token:lease.token,scanGeneration:lease.scanGeneration,memberIds:[],cursor:""}),{stale:true});
            for(const roleName of ["anon","authenticated"]) { await db.query(`set role ${roleName}`); try { await assert.rejects(rpc("set_member_role",[a,"Admin"]),{code:"42501"}); } finally {await db.query("reset role");} }
            await assert.rejects(rpc("set_member_role",[a,"arbitrary"]));
        });
    } finally { await Promise.all([db.end(),peer.end(),third.end()]); }
});
