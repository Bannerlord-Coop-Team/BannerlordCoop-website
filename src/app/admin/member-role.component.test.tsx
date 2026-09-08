import { beforeEach, expect, it, vi } from "vitest";
import pg from "pg";
const mocks=vi.hoisted(()=>({server:vi.fn(),admin:vi.fn(),target:vi.fn(),rpc:vi.fn(),legacy:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/app/lib/supabase/server",()=>({getSupabaseServerClient:mocks.server}));
vi.mock("@/app/lib/supabase/admin",()=>({getSupabaseAdminClient:mocks.admin}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`redirect:${url}`);}}));
import { updateMemberRole } from "./actions";
const actor="eeeeeeee-1111-4111-8111-111111111111", target="ffffffff-1111-4111-8111-111111111111";
function form(role="Standard Server",id=target) {const f=new FormData();f.set("userId",id);f.set("role",role);return f;}
beforeEach(()=>{
    vi.clearAllMocks();vi.stubEnv("SUPABASE_ADMIN_EMAILS","");
    mocks.server.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:actor,email:"admin@example.invalid",app_metadata:{role:"Admin"}}}})}});
    mocks.target.mockResolvedValue({data:{user:{id:target,email:"member@example.invalid",app_metadata:{role:"User",live_console_operator_server_ids:["stale"]}}},error:null});
    mocks.rpc.mockResolvedValue({error:null});mocks.legacy.mockResolvedValue({error:null});
    mocks.admin.mockReturnValue({rpc:mocks.rpc,auth:{admin:{getUserById:mocks.target,updateUserById:mocks.legacy}}});
});
it("admin action sends only finite role intent after existing deterministic authorization",async()=>{
    await expect(updateMemberRole(form())).rejects.toThrow("updated=Role+updated+successfully");
    expect(mocks.rpc).toHaveBeenCalledWith("set_member_role",{p_user_id:target,p_role:"Standard Server"});expect(mocks.legacy).not.toHaveBeenCalled();
    await expect(updateMemberRole(form("arbitrary"))).rejects.toThrow("Invalid+role");
    await expect(updateMemberRole(form("User",actor))).rejects.toThrow("cannot+remove+your+own");
    vi.stubEnv("SUPABASE_ADMIN_EMAILS","member@example.invalid");await expect(updateMemberRole(form())).rejects.toThrow("Bootstrap+administrators");
});
it("admin contention is a closed sanitized explicit retry, not false success",async()=>{
    mocks.rpc.mockResolvedValue({error:{code:"55P03",message:"private sql account data"}});
    await expect(updateMemberRole(form())).rejects.toThrow("account+is+busy");
});
it.skipIf(!process.env.WEBSITE_MEMBERSHIP_LOCK_TEST_URL)("actual admin action merges under current PostgreSQL Auth row across console removal/addition and role grant/revoke",async()=>{
    const url=new URL(process.env.WEBSITE_MEMBERSHIP_LOCK_TEST_URL!);expect(url.hostname).toBe("127.0.0.1");expect(url.pathname).toBe("/website_membership_lock_test");
    const db=new pg.Client({connectionString:url.href}),peer=new pg.Client({connectionString:url.href});await db.connect();await peer.connect();
    const rpc=async(name:string,args:Record<string,unknown>)=>{
        try {const result=await db.query(`select public.${name}(${Object.values(args).map((_,i)=>`$${i+1}`).join(",")}) r`,Object.values(args));return {data:result.rows[0].r,error:null};}
        catch(error){return {data:null,error};}
    };
    mocks.rpc.mockImplementation(rpc);
    // Baseline-only production path, not the fixed implementation: models full
    // stale app_metadata payload reaching Auth. The actual fixed action must not call it.
    mocks.legacy.mockImplementation(async(id:string,input:{app_metadata:object})=>{await db.query("update auth.users set raw_app_meta_data=raw_app_meta_data||$2::jsonb where id=$1",[id,input.app_metadata]);return {error:null};});
    try {
        for(const desired of ["Standard Server","Premium Server","User"]) for(const consoleFirst of [true,false]) {
            const id=crypto.randomUUID(),m=crypto.randomUUID();
            await db.query("insert into auth.users(id,email_confirmed_at,raw_app_meta_data) values($1,now(),'{\"role\":\"User\",\"unrelated\":true,\"live_console_operator_server_ids\":[\"removed\"]}')",[id]);
            await db.query("insert into public.patreon_accounts(user_id,patreon_user_id) values($1,$2)",[id,String(BigInt('0x'+id.replaceAll('-','').slice(0,12)))]);
            const patreon=(await db.query("select patreon_user_id from public.patreon_accounts where user_id=$1",[id])).rows[0].patreon_user_id;
            await db.query("update patreon_roles.sync_state set worker_until=null,worker_token=null");
            await rpc("patreon_role_sync",{campaign:"10",tier:"20",operation:"queue",input:{memberId:m}});
            const lease=(await rpc("patreon_role_sync",{campaign:"10",tier:"20",operation:"acquire",input:{}})).data;
            const observation={token:lease.token,memberId:m,generation:1,userId:patreon,eligible:true};
            expect((await rpc("patreon_role_sync",{campaign:"10",tier:"20",operation:"complete",input:observation})).error).toBeNull();
            expect((await db.query("select raw_app_meta_data->>'role' role from auth.users where id=$1",[id])).rows[0].role).toBe("Standard Server");
            let release!:()=>void,read!:()=>void;const barrier=new Promise<void>(r=>read=r),resume=new Promise<void>(r=>release=r);
            mocks.target.mockImplementation(async()=>{const metadata=(await db.query("select raw_app_meta_data m from auth.users where id=$1",[id])).rows[0].m;read();await resume;return {data:{user:{id,email:"member@example.invalid",app_metadata:metadata}},error:null};});
            const action=updateMemberRole(form(desired,id)).catch(error=>error);
            await barrier;
            const edit=async()=>{await peer.query("select public.set_live_console_assignment($1,'removed',null,false)",[id]);await peer.query("select public.set_live_console_assignment($1,'added',null,true)",[id]);};
            if(consoleFirst)await edit();release();expect(String(await action)).toContain("updated=Role+updated+successfully");if(!consoleFirst)await edit();
            expect((await rpc("patreon_role_sync",{campaign:"10",tier:"20",operation:"complete",input:{...observation,eligible:false}})).error).toBeNull();
            const metadata=(await db.query("select raw_app_meta_data m from auth.users where id=$1",[id])).rows[0].m;
            expect(metadata.role).toBe(desired);expect(metadata.unrelated).toBe(true);expect(metadata.live_console_operator_server_ids).toEqual(["added"]);
            expect((await db.query("select count(*) from patreon_roles.grants where user_id=$1",[id])).rows[0].count).toBe("0");
            // NOWAIT failure is a real action-visible refusal; same finite intent retries.
            await peer.query("begin");await peer.query("select 1 from auth.users where id=$1 for no key update",[id]);
            try {await expect(updateMemberRole(form("Helper",id))).rejects.toThrow("account+is+busy");}finally{await peer.query("rollback");}
            expect((await db.query("select raw_app_meta_data m from auth.users where id=$1",[id])).rows[0].m).toEqual(metadata);
            await expect(updateMemberRole(form("Helper",id))).rejects.toThrow("updated=Role+updated+successfully");
        }
        expect(mocks.legacy).not.toHaveBeenCalled();
    }finally{await peer.end();await db.end();}
});
