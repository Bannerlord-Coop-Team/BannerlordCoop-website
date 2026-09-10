// Mandatory real pinned GoTrue admin deletion. Loopback disposable Auth only;
// authenticated admin HTTP (signed JWT), not browser/TLS/OAuth end-to-end evidence.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import pg from "pg";
const url=process.env.WEBSITE_MEMBERSHIP_AUTH_TEST_URL;
const binary=process.env.WEBSITE_GOTRUE_BINARY;
test("GoTrue v2.177.0 actual admin deletion refuses atomically and explicit same-ID retry completes",{skip:!url||!binary},async()=>{
    const target=new URL(url!); assert.equal(target.hostname,"127.0.0.1");assert.equal(target.pathname,"/website_membership_auth_test");
    assert.equal(createHash("sha256").update(await readFile(binary!)).digest("hex"),"bde91101eb64db8dbbbd1489ae005bf9f8d54bcd47753d04e811779e30cfcd5a");
    const db=new pg.Client({connectionString:url}); const peer=new pg.Client({connectionString:url});await db.connect();await peer.connect();
    const port=await new Promise<number>(resolve=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const a=s.address();assert.ok(a&&typeof a==="object");s.close(()=>resolve(a.port));});});
    const origin=`http://127.0.0.1:${port}`;const secret=randomBytes(48).toString("base64url");
    const encoded=(x:object)=>Buffer.from(JSON.stringify(x)).toString("base64url");
    const unsigned=encoded({alg:"HS256",typ:"JWT"})+"."+encoded({role:"service_role",iss:"supabase",aud:"authenticated",exp:Math.floor(Date.now()/1000)+600});
    const jwt=unsigned+"."+createHmac("sha256",secret).update(unsigned).digest("base64url");
    const authPassword=randomBytes(32).toString("hex");
    await db.query(`create role website_gotrue_fixture login password '${authPassword}'`);
    await db.query("create role postgres nologin; create schema auth authorization website_gotrue_fixture; grant usage on schema public to website_gotrue_fixture; alter role website_gotrue_fixture set search_path=auth,public");
    const authUrl=new URL(url!);authUrl.username="website_gotrue_fixture";authUrl.password=authPassword;
    // Only synthetic in-memory fixture keys; never inherit ambient environment.
    const authEnvironment:NodeJS.ProcessEnv={NODE_ENV:"test",PATH:"/usr/bin:/bin",GOTRUE_API_HOST:"127.0.0.1",GOTRUE_API_PORT:String(port),API_EXTERNAL_URL:origin,GOTRUE_SITE_URL:origin,GOTRUE_DB_DRIVER:"postgres",GOTRUE_DB_DATABASE_URL:authUrl.href,GOTRUE_DB_NAMESPACE:"auth",GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_EXP:"3600",GOTRUE_JWT_AUD:"authenticated",GOTRUE_JWT_DEFAULT_GROUP_NAME:"authenticated",GOTRUE_JWT_ADMIN_ROLES:"service_role",GOTRUE_DISABLE_SIGNUP:"true",GOTRUE_EXTERNAL_EMAIL_ENABLED:"true",GOTRUE_MAILER_AUTOCONFIRM:"true",GOTRUE_LOG_LEVEL:"panic"};
    const migration=spawn(binary!,["migrate"],{cwd:binary!.replace("/bin/auth","/etc/auth"),env:{...authEnvironment,GOTRUE_LOG_LEVEL:"error"},stdio:["ignore","pipe","pipe"]});
    let diagnostic=""; for(const stream of [migration.stdout,migration.stderr])stream.on("data",chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-8000);});
    const migrated=await new Promise(resolve=>migration.once("exit",resolve));
    if(migrated!==0){await peer.end();await db.end();const sanitized=diagnostic.replaceAll(authUrl.href,"[fixture-url]").replaceAll(authPassword,"[fixture-password]").replaceAll(secret,"[fixture-key]").replace(/postgres(?:ql)?:\/\/[^\s\"']+/g,"[fixture-url]");assert.fail("pinned GoTrue migrations: "+sanitized);}
    const auth=spawn(binary!,["serve"],{cwd:process.cwd(),env:authEnvironment,stdio:"ignore"});
    async function request(path:string,method:string,body?:object) {return fetch(origin+path,{method,headers:{Authorization:`Bearer ${jwt}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});}
    try {
        for(let i=0;i<200;i++) { if(auth.exitCode!==null)assert.fail("Pinned Auth exited before health (no sensitive log retained)");try {if((await fetch(origin+"/health")).ok)break;}catch{}if(i===199)assert.fail("Auth health timeout");await new Promise(r=>setTimeout(r,50)); }
        const health=await (await fetch(origin+"/health")).json();assert.match(health.version,/2\.177\.0/);console.log("PINNED_GOTRUE_HEALTH",health.version);
        // Auth owns its actual migrations/schema; add the exact combined website SQL.
        for(const name of ["20260907212654_create_patreon_links.sql","20260907220000_patreon_website_roles.sql","20260907230000_atomic_live_console_assignments.sql","202609080002_membership_onboarding.sql","202609080003_membership_role_locking.sql","20260908030000_patreon_event_reconciliation.sql","20260910200000_membership_receipt_claims.sql"]) await db.query(await readFile(`supabase/migrations/${name}`,"utf8"));
        assert.equal((await fetch(origin+"/admin/users")).status,401,"JWT verification is not bypassed");
        const tables=["auth.users","auth.identities","auth.sessions","auth.refresh_tokens","public.patreon_accounts","public.membership_heads","public.membership_outbox","public.membership_completion_receipts","patreon_roles.memberships","patreon_roles.grants","patreon_roles.sync_state","patreon_roles.audit"];
        async function snapshot() {const result:Record<string,unknown>={};for(const table of tables)result[table]=(await db.query(`select to_jsonb(t) r from ${table} t order by to_jsonb(t)::text`)).rows;return result;}
        for(const mode of ["ordinary","serialized","refused"] as const) {
            const contend=mode==="refused";
            const created=await request("/admin/users","POST",{email:`owned-${crypto.randomUUID()}@example.invalid`,email_confirm:true,password:randomBytes(24).toString("base64url")});assert.equal(created.status,200);const account=(await created.json()).id;assert.match(account,/^[0-9a-f-]{36}$/);
            await db.query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,$2)",[account,mode==="ordinary"?"123":mode==="serialized"?"234":"456"]);
            await db.query("select public.membership_fence($1,null,false)",[account]);
            const patreon=mode==="ordinary"?"123":mode==="serialized"?"234":"456";
            const member=crypto.randomUUID();await db.query("update patreon_roles.sync_state set worker_until=null,worker_token=null");
            await db.query("select public.patreon_role_sync('10','20','queue',$1)",[{memberId:member}]);
            const lease=(await db.query("select public.patreon_role_sync('10','20','acquire','{}') r")).rows[0].r;
            await db.query("select public.patreon_role_sync('10','20','complete',$1)",[{token:lease.token,memberId:member,generation:1,userId:patreon,eligible:true}]);
            const token=randomBytes(32).toString("hex"),op=crypto.randomUUID();
            await db.query("insert into public.patreon_oauth_states(token_hash,kind,user_id,patreon_user_id,expires_at,operation_id,expected_generation,return_path,evidence) select $1,'complete',account_id,$2,now()+interval '10 minutes',$3,link_generation,'/account',public.membership_empty_evidence() from public.membership_heads where account_id=$4",[token,patreon,op,account]);
            await db.query("select public.membership_complete($1,null,$2)",[account,token]);
            const receipt=(await db.query("select * from public.membership_completion_receipts where operation_id=$1",[op])).rows;
            assert.equal(receipt.length,1);assert.equal((await db.query("select count(*) from patreon_roles.grants where user_id=$1",[account])).rows[0].count,"1");
            if(contend) {
                await peer.query("begin;select pg_advisory_xact_lock(hashtextextended($1::text,702))",[account]); const before=await snapshot();
                try {
                    const refused=await request(`/admin/users/${account}`,"DELETE");assert.equal(refused.status,500);
                    const error=await refused.json();assert.equal(error.code,500);
                    assert.deepEqual(await snapshot(),before,"Auth/link/tombstone/projection/outbox all unchanged after actual Auth transaction refusal");
                    assert.equal((await request(`/admin/users/${account}`,"GET")).status,200);
                    console.log("GOTRUE_DELETE_REFUSED",JSON.stringify({status:refused.status,code:error.code,wholeTransactionRollback:true,automaticRetry:false}));
                } finally {await peer.query("rollback");}
            }
            let deleted:Response;
            if(mode==="serialized") {
                await peer.query("begin");
                await peer.query("select public.patreon_role_sync('10','20','queue',$1)",[{memberId:crypto.randomUUID()}]);
                await peer.query("select 1 from auth.users where id=$1 for no key update",[account]);
                const pending=request(`/admin/users/${account}`,"DELETE");
                try {
                    for(let i=0;i<100;i++) {
                        const waiting=(await db.query("select count(*) from pg_stat_activity where datname=current_database() and usename='website_gotrue_fixture' and wait_event_type='Lock'")).rows[0].count;
                        if(waiting!=="0")break;if(i===99)assert.fail("GoTrue pre-row wait barrier not reached");await new Promise(r=>setTimeout(r,10));
                    }
                    assert.equal((await db.query("select link_state from public.membership_heads where account_id=$1",[account])).rows[0].link_state,"linked");
                    await peer.query("commit"); deleted=await pending;
                } finally {await peer.query("rollback");}
            } else deleted=await request(`/admin/users/${account}`,"DELETE");
            assert.equal(deleted.status,200);
            assert.equal((await request(`/admin/users/${account}`,"GET")).status,404);
            const head=(await db.query("select * from public.membership_heads where account_id=$1",[account])).rows[0];assert.equal(head.link_state,"account_deleted");assert.equal(head.patreon_user_id,null);
            assert.equal((await db.query("select count(*) from public.patreon_accounts where user_id=$1",[account])).rows[0].count,"0");
            assert.deepEqual((await db.query("select * from public.membership_completion_receipts where operation_id=$1",[op])).rows,receipt,"immutable completed history survives actual Auth deletion");
            assert.equal((await db.query("select count(*) from patreon_roles.grants where user_id=$1",[account])).rows[0].count,"0");
            const events=(await db.query("select event_id from public.membership_outbox where account_id=$1 and receipt_id is null order by sequence",[account])).rows;assert.ok(events.length>0);
            for(const e of events)await db.query("select public.membership_ack($1,$2)",[e.event_id,crypto.randomUUID()]);
            console.log("GOTRUE_DELETE_COMMITTED",JSON.stringify({mode,explicitRetry:contend,tombstone:true,ackSafe:true}));
        }
    } finally {auth.kill("SIGTERM");await new Promise<void>(resolve=>{if(auth.exitCode!==null)resolve();else auth.once("exit",()=>resolve());});await peer.end();await db.end();}
});
