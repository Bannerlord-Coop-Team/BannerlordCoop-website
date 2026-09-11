import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), unlink: vi.fn(), invoke: vi.fn(), link: vi.fn(), exchange: vi.fn(), user: vi.fn(), session: vi.fn(), admin: vi.fn(), stamp: vi.fn(), jar: new Map<string,string>() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: (key:string) => mocks.jar.has(key), get: (key:string) => mocks.jar.has(key) ? { value: mocks.jar.get(key) } : undefined, set: (key:string,value:string) => mocks.jar.set(key,value), delete: (key:string) => mocks.jar.delete(key) }) }));
import { disconnectDiscordAccount, disconnectPatreonAccount, automaticallyCompletePatreonAccount, linkDiscordAccount, completePatreonAccount, confirmDiscordAccount, resolveAccountLink } from "./actions";
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/app/account/AccountStatusSync", () => ({ AccountStatusSync: () => null }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
import { act } from "react";
import { createRoot } from "react-dom/client";
import AccountPage from "./page";
import { EMPTY_MEMBERSHIP } from "@/app/lib/hosting/membership-onboarding";
import { GET as discordCallback } from "./discord/callback/route";
import { GET as patreonCallback } from "./patreon/callback/route";
import { NextRequest } from "next/server";
const a = "aaaaaaaa-1111-4111-8111-111111111111";
const token = "a".repeat(64);
beforeEach(() => {
    vi.clearAllMocks(); mocks.jar.clear();
    vi.stubEnv("ACCOUNT_LINK_SITE_URL","https://website.example");
    mocks.user.mockResolvedValue({ data: { user: { id: a, identities: [] } } });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "synthetic-jwt", user: { id: a } } } });
    mocks.invoke.mockResolvedValue({ data: { token, accountId: a }, error: null });
    mocks.link.mockResolvedValue({ data: { url: "https://discord.com/oauth2/authorize?state=supabase-owned-state" }, error: null });
    mocks.exchange.mockResolvedValue({ error: null });
    mocks.admin.mockReturnValue({ rpc: mocks.stamp });
    mocks.stamp.mockResolvedValue({ data: { verified: true }, error: null });
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.user, getSession: mocks.session, linkIdentity: mocks.link, unlinkIdentity: mocks.unlink, exchangeCodeForSession: mocks.exchange }, functions: { invoke: mocks.invoke } });
});
it("disconnects only the current account's exact Discord identity with another sign-in method", async () => {
    const identity = { provider: "discord", identity_id: "discord-identity" };
    mocks.user.mockResolvedValue({ data: { user: { id: a, identities: [identity, { provider: "email", identity_id: "email-identity" }] } } });
    mocks.unlink.mockResolvedValue({ data: {}, error: null });
    await expect(disconnectDiscordAccount(a, "discord-identity")).rejects.toThrow("redirect:/account?discord=disconnected");
    expect(mocks.unlink).toHaveBeenCalledWith(identity);
    expect(mocks.invoke).not.toHaveBeenCalled();
});
it.each(["only_identity", "account_changed", "identity_changed", "auth_error"])("Discord disconnect fails safely for %s", async scenario => {
    const identity = { provider: "discord", identity_id: "discord-identity" };
    mocks.user.mockResolvedValue({ data: { user: { id: a, identities: scenario === "only_identity" ? [identity] : [identity, { provider: "email", identity_id: "email-identity" }] } } });
    mocks.unlink.mockResolvedValue({ data: null, error: new Error("private Auth detail") });
    await expect(disconnectDiscordAccount(scenario === "account_changed" ? "another-account" : a, scenario === "identity_changed" ? "old-identity" : "discord-identity")).rejects.toThrow(`redirect:/account?discord=${scenario === "only_identity" ? "last_identity" : "disconnect_error"}`);
    expect(mocks.unlink).toHaveBeenCalledTimes(scenario === "auth_error" ? 1 : 0);
});
it("Patreon disconnect keeps existing backend unlink behavior and rejects account switches", async () => {
    await expect(disconnectPatreonAccount("another-account")).rejects.toThrow("redirect:/account?patreon=disconnect_error");
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue({ data: { unlinked: true }, error: null });
    await expect(disconnectPatreonAccount(a)).rejects.toThrow("redirect:/account?patreon=unlinked");
    expect(mocks.invoke).toHaveBeenCalledWith("website-account", expect.objectContaining({ body: { operation: "unlink" } }));
});

it("Discord calls linkIdentity, keeps Supabase OAuth state untouched, server-binds initiating UUID and safe continuation", async () => {
    const form = new FormData(); form.set("returnPath","/servers");
    await expect(linkDiscordAccount(form)).rejects.toThrow("redirect:https://discord.com/oauth2/authorize?state=supabase-owned-state");
    expect(mocks.invoke).toHaveBeenCalledWith("website-account", expect.objectContaining({ body: { operation: "discord-start", returnPath: "/servers" } }));
    expect(mocks.link).toHaveBeenCalledWith({ provider: "discord", options: { redirectTo: "https://website.example/account/discord/callback" } });
    expect(mocks.jar.get("__Host-account-link")).toBe(token);
});
it.each(["disabled", "foreign_identity", "untrusted_destination"])("Discord %s fails into repair without substituting sign-in", async failure => {
    mocks.link.mockResolvedValue(failure === "untrusted_destination" ? { data: { url: "https://attacker.invalid/" }, error: null } : { data: {}, error: { message: failure } });
    await expect(linkDiscordAccount(new FormData())).rejects.toThrow("redirect:/account?discord=repair");
    expect(mocks.jar.get("__Host-account-link")).toBe(token);
});
it("account switch before Discord callback cannot exchange OAuth code or complete", async () => {
    mocks.invoke.mockResolvedValue({ error: new Error("initiator mismatch"), data: null });
    const request = new NextRequest("https://website.example/account/discord/callback?code=synthetic", { headers: { cookie: `__Host-account-link=${token}` } });
    const response = await discordCallback(request);
    expect(response.headers.get("location")).toBe("https://website.example/account?discord=repair"); expect(mocks.exchange).not.toHaveBeenCalled();
});
it("Discord callback requires same UUID both before and after Supabase code exchange, explicit confirmation follows", async () => {
    mocks.invoke.mockResolvedValue({ data: { valid: true }, error: null });
    mocks.user.mockResolvedValue({ data: { user: { id: a, identities: [{ provider: "discord", identity_data: { provider_id: "123456789012345678" } }] } } });
    const response = await discordCallback(new NextRequest("https://website.example/account/discord/callback?code=synthetic", { headers: { cookie: `__Host-account-link=${token}` } }));
    expect(response.headers.get("location")).toContain("discord=confirm");
    expect(mocks.invoke).toHaveBeenCalledTimes(1); expect(mocks.invoke.mock.calls[0][1].body.operation).toBe("discord-check");
    mocks.jar.set("__Host-account-link",token); mocks.invoke.mockResolvedValue({ data: { confirmed: true, returnPath: "/servers" }, error: null });
    await expect(confirmDiscordAccount()).rejects.toThrow("redirect:/servers");
});
it("Patreon callback GET never invokes completion; POST retries preserve the same authority on response loss", async () => {
    const response = await patreonCallback(new NextRequest(`https://website.example/account/patreon/callback?token=${token}`));
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(response.headers.get("location")).toContain("patreon=confirm"); expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    mocks.jar.set("__Host-patreon-completion",token); mocks.invoke.mockResolvedValue({ data: null, error: new Error("response lost") });
    await expect(completePatreonAccount()).rejects.toThrow("redirect:/account?patreon=confirm_error"); expect(mocks.jar.get("__Host-patreon-completion")).toBe(token);
    mocks.invoke.mockResolvedValue({ data: { linked: true, returnPath: "/servers" }, error: null });
    await expect(completePatreonAccount()).rejects.toThrow("redirect:/servers?patreon=linked"); expect(mocks.jar.get("__Host-patreon-completion")).toBe(token);
    expect(mocks.invoke.mock.calls.every(call=>call[1].body.token===token)).toBe(true);
});

it("automatic Patreon completion checks the rendered account and operation before committing", async () => {
    mocks.jar.set("__Host-patreon-completion", token);
    mocks.invoke.mockImplementation(async (_name, options) => options.body.operation === "recovery-status"
        ? { data: { ...bound(), provider: "patreon" }, error: null }
        : { data: { linked: true, returnPath: "/account" }, error: null });
    await expect(automaticallyCompletePatreonAccount(a, operationId)).rejects.toThrow("redirect:/account?patreon=linked");
    expect(mocks.invoke).toHaveBeenCalledWith("patreon-complete", expect.objectContaining({ body: { token } }));
    expect(mocks.jar.get("__Host-patreon-completion")).toBe(token);
});
it.each(["account", "operation", "expired", "unconfirmable", "unavailable"])("automatic Patreon completion refuses changed %s authority", async change => {
    mocks.jar.set("__Host-patreon-completion", token);
    const recovery = { ...bound(), provider: "patreon", ...(change === "operation" ? { operationId: "ffffffff-1111-4111-8111-111111111111" } : {}), ...(change === "expired" ? { state: "expired", confirmable: false } : {}), ...(change === "unconfirmable" ? { confirmable: false } : {}) };
    mocks.invoke.mockResolvedValue(change === "unavailable" ? { data: null, error: new Error("unavailable") } : { data: recovery, error: null });
    await expect(automaticallyCompletePatreonAccount(change === "account" ? "another-account" : a, operationId)).rejects.toThrow("redirect:/account?patreon=confirm_error");
    expect(mocks.invoke.mock.calls.some(call => call[0] === "patreon-complete")).toBe(false);
    expect(mocks.jar.get("__Host-patreon-completion")).toBe(token);
});

it("rate-limited completion and Discord begin retain cookie authority and show bounded retry guidance", async () => {
    mocks.jar.set("__Host-patreon-completion",token); mocks.jar.set("__Host-account-link",token);
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response("private database details", { status: 429, headers: { "Retry-After": "600" } }) } });
    await expect(completePatreonAccount()).rejects.toThrow("redirect:/account?patreon=rate_limited");
    expect(mocks.jar.get("__Host-patreon-completion")).toBe(token);
    await expect(linkDiscordAccount(new FormData())).rejects.toThrow("redirect:/account?discord=rate_limited");
    expect(mocks.jar.get("__Host-account-link")).toBe(token); expect(mocks.link).not.toHaveBeenCalled();
});

const operationId = "eeeeeeee-1111-4111-8111-111111111111";
const bound = (state = "live", confirmable = true) => ({ accountId: a, provider: "discord", operationId, state, confirmable, returnPath: "/servers" });
function pageResponses(recovery: unknown, hasDiscord = true) {
    mocks.invoke.mockImplementation(async (_name, options) => {
        if (options.body.operation === "status") return { data: { version: 1, accountId: a, hasDiscord, configured: true, verificationPending: false, membership: EMPTY_MEMBERSHIP }, error: null };
        if (options.body.operation === "recovery-status") return { data: options.body.provider === "discord" ? recovery : { accountId: a, provider: "patreon", state: "none" }, error: null };
        return { data: null, error: new Error("unexpected operation") };
    });
}
async function mount(params: { discord?: string } = {}) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    await act(async () => root.render(await AccountPage({ searchParams: Promise.resolve(params) })));
    return { container, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}
it("mounted Discord throttle landing, reload and account return retain exact authenticated confirmation", async () => {
    mocks.jar.set("__Host-account-link", token);
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(null, { status: 429 }) } });
    await expect(confirmDiscordAccount()).rejects.toThrow("redirect:/account?discord=rate_limited");
    expect(mocks.jar.get("__Host-account-link")).toBe(token);
    for (const params of [{ discord: "rate_limited" }, {}, { discord: "confirm" }]) {
        pageResponses(bound()); const view = await mount(params);
        try { expect(view.container.textContent).toContain("Confirm Discord connection"); expect(view.container.textContent).not.toContain("Wait at least 10 minutes"); }
        finally { await view.close(); }
    }
    mocks.invoke.mockResolvedValue({ data: { confirmed: true, returnPath: "/servers" }, error: null });
    await expect(confirmDiscordAccount()).rejects.toThrow("redirect:/servers");
    expect(mocks.invoke).toHaveBeenLastCalledWith("website-account", expect.objectContaining({ body: { operation: "discord-confirm", token } }));
});
it.each(["live", "expired", "committed"])("cookie expiry/reload renders honest %s recovery, not a fresh operation", async state => {
    pageResponses(bound(state, false)); const view = await mount();
    try {
        expect(view.container.textContent).not.toContain("Confirm Discord connection");
        expect(view.container.textContent).toContain(state === "committed" ? "Recover Discord result" : state === "expired" ? "Resolve expired Discord attempt" : "Cancel pending Discord attempt");
        expect(view.container.textContent).toContain("My Servers");
        expect(view.container.querySelector('input[name="operationId"]')?.getAttribute("value")).toBe(operationId);
        expect(mocks.invoke).toHaveBeenCalledWith("website-account", expect.objectContaining({ body: { operation: "recovery-status", provider: "discord", token: null } }));
    } finally { await view.close(); }
});
it("rejected begin has no pending control and permits explicit restart only while Auth unlinked", async () => {
    pageResponses({ accountId: a, provider: "discord", state: "none" }, false); const view = await mount({ discord: "rate_limited" });
    try { expect(view.container.textContent).toContain("Confirm and connect Discord"); expect(view.container.textContent).not.toContain("Cancel pending Discord"); } finally { await view.close(); }
});
it("foreign/account-switched status never renders confirmation or allows blind replacement", async () => {
    mocks.jar.set("__Host-account-link", token); pageResponses({ ...bound(), accountId: "bbbbbbbb-1111-4111-8111-111111111111" }, false);
    const view = await mount({ discord: "confirm" });
    try { expect(view.container.textContent).not.toContain("Confirm Discord connection"); expect(view.container.textContent).not.toContain("Confirm and connect Discord"); expect(view.container.textContent).toContain("recovery is unavailable"); } finally { await view.close(); }
});
it("exact resolve preserves intent on unknown/foreign outcome; concurrent committed result follows original continuation", async () => {
    const form = new FormData(); form.set("provider", "discord"); form.set("operationId", operationId); mocks.jar.set("__Host-account-link", token);
    for (const response of [{ data: null, error: new Error("lost") }, { data: { ...bound("cancelled"), accountId: "foreign" }, error: null }]) {
        mocks.invoke.mockResolvedValue(response); await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?recovery=unavailable"); expect(mocks.jar.get("__Host-account-link")).toBe(token);
    }
    mocks.invoke.mockResolvedValue({ data: bound("committed"), error: null }); await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/servers?discord=recovered"); expect(mocks.jar.get("__Host-account-link")).toBe(token);
});
it("callback marker unknown response retains recovery and never infers success from Auth; exchange/account failures cannot stamp", async () => {
    mocks.invoke.mockResolvedValue({ data: { valid: true }, error: null });
    mocks.user.mockResolvedValue({ data: { user: { id: a, identities: [{ provider: "discord", identity_data: { provider_id: "123456789012345678" } }] } } });
    mocks.stamp.mockResolvedValue({ data: null, error: new Error("commit response lost or cancelled") });
    const req = () => new NextRequest("https://website.example/account/discord/callback?code=synthetic", { headers: { cookie: `__Host-account-link=${token}` } });
    expect((await discordCallback(req())).headers.get("location")).toContain("discord=repair");
    expect(mocks.stamp).toHaveBeenCalledWith("membership_discord_callback", expect.objectContaining({ p_account_id: a, p_discord_user_id: "123456789012345678" }));
    mocks.stamp.mockClear(); mocks.exchange.mockResolvedValue({ error: new Error("code consumed") }); await discordCallback(req()); expect(mocks.stamp).not.toHaveBeenCalled();
    mocks.exchange.mockResolvedValue({ error: null }); mocks.user.mockResolvedValueOnce({ data: { user: { id: a } } }).mockResolvedValueOnce({ data: { user: { id: "foreign" } } }); await discordCallback(req()); expect(mocks.stamp).not.toHaveBeenCalled();
});

it("missing existing server callback configuration fails before consuming PKCE", async () => {
    mocks.invoke.mockResolvedValue({ data: { valid: true }, error: null }); mocks.admin.mockImplementation(() => { throw new Error("not configured"); });
    const response=await discordCallback(new NextRequest("https://website.example/account/discord/callback?code=synthetic", { headers: { cookie: `__Host-account-link=${token}` } }));
    expect(response.headers.get("location")).toContain("discord=repair"); expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.stamp).not.toHaveBeenCalled();
});

it.each([false, true])("mounted historical Discord retirement/restart after cookie loss, prior acknowledgment=%s", async acknowledged => {
    mocks.jar.set("__Host-account-link", token);
    mocks.invoke.mockResolvedValue({ data: { confirmed: true, returnPath: "/servers" }, error: null });
    await expect(confirmDiscordAccount()).rejects.toThrow("redirect:/servers"); expect(mocks.jar.get("__Host-account-link")).toBe(token);
    mocks.jar.clear(); // Simulate browser cookie expiry after successful confirmation.
    // Synthetic authoritative Auth unlink after cookie loss.
    pageResponses(bound(acknowledged ? "retired" : "historical", false), false);
    let view=await mount();
    try {
        expect(view.container.textContent).toContain("historical Discord attempt");
        expect(view.container.textContent).not.toContain("Recover Discord result");
        expect(view.container.textContent).not.toContain("Confirm Discord connection");
        expect(view.container.textContent).toContain("Retire historical Discord reference");
        if(!acknowledged) expect(view.container.textContent).not.toContain("Confirm and connect Discord");
    } finally { await view.close(); }
    const form=new FormData(); form.set("provider","discord"); form.set("operationId",operationId);
    mocks.invoke.mockResolvedValue({ data:null, error:new Error("retirement committed but response lost") });
    await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?recovery=unavailable");
    pageResponses(bound("retired",false),false); view=await mount();
    try { expect(view.container.textContent).toContain("Confirm and connect Discord"); expect(view.container.textContent).not.toContain("Recover Discord result"); }
    finally { await view.close(); }
    mocks.invoke.mockResolvedValue({ data:bound("retired",false),error:null });
    await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?discord=retired");
    mocks.invoke.mockResolvedValue({ data:{accountId:a,token},error:null });
    await expect(linkDiscordAccount(new FormData())).rejects.toThrow("redirect:https://discord.com/oauth2/authorize");
    expect(mocks.link).toHaveBeenCalledTimes(1);
});
it("historical different current Auth permits normal continuation, never reports old success or starts linking", async () => {
    mocks.user.mockResolvedValue({data:{user:{id:a,identities:[{provider:"discord",identity_data:{provider_id:"999456789012345678"}}]}}});
    pageResponses(bound("historical",false)); const view=await mount();
    try {
        expect(view.container.textContent).toContain("My Servers");
        expect(view.container.textContent).toContain("current Auth connection remains usable");
        expect(view.container.textContent).not.toContain("Confirm and connect Discord");
        expect(view.container.textContent).not.toContain("Recover Discord result");
    } finally { await view.close(); }
    await expect(linkDiscordAccount(new FormData())).rejects.toThrow("redirect:/account?discord=repair"); expect(mocks.link).not.toHaveBeenCalled();
});
it.each([
    {...bound("retired",false),accountId:"foreign"}, {...bound("retired",false),operationId:"ffffffff-1111-4111-8111-111111111111"},
    bound("unknown",false), {...bound("retired",true)}, {...bound("historical",true)},
    {...bound("retired",false),receipt:{confirmed:true}}, {...bound("historical",false),provider:"patreon"}
])("foreign, superseding or unknown recovery DTO refuses cookie deletion and false success: %j", async data => {
    mocks.jar.set("__Host-account-link",token); mocks.invoke.mockResolvedValue({data,error:null});
    const form=new FormData(); form.set("provider","discord"); form.set("operationId",operationId);
    await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?recovery=unavailable"); expect(mocks.jar.get("__Host-account-link")).toBe(token);
    pageResponses(data,false); const view=await mount();
    try { if(data.accountId!=="foreign" && data.operationId===operationId) expect(view.container.textContent).toContain("recovery is unavailable"); }
    finally { await view.close(); }
});
it("a delayed successful retirement response cannot erase a newer browser authority", async () => {
    const newer="b".repeat(64); mocks.jar.set("__Host-account-link",newer);
    mocks.invoke.mockResolvedValue({data:bound("retired",false),error:null});
    const form=new FormData(); form.set("provider","discord"); form.set("operationId",operationId);
    await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?discord=retired");
    expect(mocks.jar.get("__Host-account-link")).toBe(newer);
});
it.each([
    ["discord", "cancelled"], ["discord", "committed"], ["discord", "retired"],
    ["patreon", "cancelled"], ["patreon", "committed"],
    ["discord", "confirm"], ["patreon", "confirm"],
])("delayed %s %s response preserves newer cookie and callback authority", async (provider, state) => {
    const key = provider === "discord" ? "__Host-account-link" : "__Host-patreon-completion";
    const newer = "b".repeat(64);
    mocks.jar.set(key, token);
    let release!: (value: { data: unknown; error: null }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.invoke.mockImplementationOnce(() => {
        entered();
        return new Promise(resolve => { release = resolve; });
    });
    const form = new FormData(); form.set("provider", provider); form.set("operationId", operationId);
    const oldResponse = (state === "confirm"
        ? provider === "discord" ? confirmDiscordAccount() : completePatreonAccount()
        : resolveAccountLink(form)).catch(error => error as Error);
    await started; // Old operation has committed; its response is still deferred.
    if (provider === "discord") {
        mocks.invoke.mockResolvedValue({ data: { accountId: a, token: newer }, error: null });
        await expect(linkDiscordAccount(new FormData())).rejects.toThrow("redirect:https://discord.com/oauth2/authorize");
    } else {
        const response = await patreonCallback(new NextRequest(`https://website.example/account/patreon/callback?token=${newer}`));
        expect(response.cookies.get(key)?.value).toBe(newer);
        mocks.jar.set(key, response.cookies.get(key)!.value); // Deliver tab B's Set-Cookie.
    }
    expect(mocks.jar.get(key)).toBe(newer);
    release({ data: state === "confirm" ? { confirmed: true, linked: true, returnPath: "/servers" } : { ...bound(state, false), provider }, error: null });
    const expected = state === "confirm" ? provider === "discord" ? "/servers" : "/servers?patreon=linked"
        : state === "committed" ? `/servers?${provider}=recovered` : `/account?${provider}=${state}`;
    expect((await oldResponse as Error).message).toBe(`redirect:${expected}`);
    expect(mocks.jar.get(key)).toBe(newer);
    if (provider === "discord") {
        mocks.invoke.mockResolvedValue({ data: { valid: true }, error: null });
        mocks.user.mockResolvedValue({ data: { user: { id: a, identities: [{ provider: "discord", identity_data: { provider_id: "123456789012345678" } }] } } });
        const response = await discordCallback(new NextRequest("https://website.example/account/discord/callback?code=new-code", { headers: { cookie: `${key}=${mocks.jar.get(key)}` } }));
        expect(response.headers.get("location")).toContain("discord=confirm");
        expect(mocks.invoke).toHaveBeenLastCalledWith("website-account", expect.objectContaining({ body: { operation: "discord-check", token: newer } }));
    } else {
        mocks.invoke.mockResolvedValue({ data: { linked: true, returnPath: "/servers" }, error: null });
        await expect(completePatreonAccount()).rejects.toThrow("redirect:/servers?patreon=linked");
        expect(mocks.invoke).toHaveBeenLastCalledWith("patreon-complete", expect.objectContaining({ body: { token: newer } }));
    }
});

it("failed Discord confirmation preserves authority and never redirects as confirmed", async () => {
    mocks.jar.set("__Host-account-link",token); mocks.invoke.mockResolvedValue({data:null,error:new Error("expired inside RPC")});
    await expect(confirmDiscordAccount()).rejects.toThrow("redirect:/account?discord=repair"); expect(mocks.jar.get("__Host-account-link")).toBe(token);
});

it.runIf(Boolean(process.env.WEBSITE_MEMBERSHIP_TEST_URL))("real PostgreSQL mounted handler/action lifecycle: commit, cookie loss, Auth change, retirement and restart", async () => {
    const { default: pg } = await import("pg");
    const { createWebsiteAccountHandler } = await import("../../../supabase/functions/_shared/website-account");
    const { sha256 } = await import("../../../supabase/functions/_shared/membership");
    const target=new URL(process.env.WEBSITE_MEMBERSHIP_TEST_URL!);
    expect(["localhost","127.0.0.1"]).toContain(target.hostname); expect(target.pathname).toBe("/website_membership_test");
    const db=new pg.Client({connectionString:target.href}); await db.connect();
    let accountId=crypto.randomUUID(), current: string|null=null;
    const authUser=()=>({id:accountId,identities:current ? [{provider:"discord",identity_data:{provider_id:current}}] : []});
    const rpc=async(name:string,args:Record<string,unknown>)=>{
        const allowed=["membership_status","membership_recovery","membership_discord_begin","membership_discord_check","membership_discord_callback","membership_discord_confirm"];
        if(!allowed.includes(name) || Object.keys(args).some(k=>!/^p_[a-z_]+$/u.test(k))) throw new Error("Fixture RPC refused");
        await db.query("set role service_role");
        try { return (await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>`${k} => $${i+1}`).join(",")}) r`,Object.values(args))).rows[0].r; }
        finally { await db.query("reset role"); }
    };
    const handler=createWebsiteAccountHandler({supabaseUrl:"https://fixture.invalid",serviceRoleKey:"synthetic-not-a-credential",policy:null,fetch:async(input,init)=>{
        const path=new URL(String(input)).pathname;
        if(path==="/auth/v1/user") return Response.json(authUser());
        try { return Response.json(await rpc(path.replace("/rest/v1/rpc/",""),JSON.parse(String(init?.body)))); }
        catch { return Response.json({error:"fixture_rpc_refused"},{status:503}); }
    }});
    let loseRetirement=false;
    mocks.user.mockImplementation(async()=>({data:{user:authUser()}}));
    mocks.session.mockImplementation(async()=>({data:{session:{user:{id:accountId},access_token:"synthetic-jwt"}}}));
    mocks.invoke.mockImplementation(async(_name,options)=>{
        const response=await handler(new Request("https://fixture.invalid/website-account",{method:"POST",headers:{Authorization:"Bearer synthetic-jwt","Content-Type":"application/json"},body:JSON.stringify(options.body)}));
        if(loseRetirement && options.body.operation==="recovery-resolve") { loseRetirement=false; return {data:null,error:new Error("lost committed retirement response")}; }
        return {data:await response.json(),error:response.ok ? null : new Error("fixture refusal")};
    });
    mocks.stamp.mockImplementation(async(name,args)=>({data:await rpc(name,args),error:null}));
    try {
        for(const acknowledged of [false,true]) for(const changed of [null,"999456789012345678"]) {
            accountId=crypto.randomUUID(); current=null; mocks.jar.clear();
            await db.query("insert into auth.users values($1)",[accountId]);
            await expect(linkDiscordAccount(new FormData())).rejects.toThrow("redirect:https://discord.com/oauth2/authorize");
            const authority=mocks.jar.get("__Host-account-link")!, hash=await sha256(authority);
            current="123456789012345678";
            const callback=await discordCallback(new NextRequest("https://website.example/account/discord/callback?code=synthetic",{headers:{cookie:`__Host-account-link=${authority}`}}));
            expect(callback.headers.get("location")).toContain("discord=confirm");
            await expect(confirmDiscordAccount()).rejects.toThrow("redirect:/account"); expect(mocks.jar.get("__Host-account-link")).toBe(authority);
            mocks.jar.clear(); // Simulate browser cookie expiry.
            const history=(await db.query("select * from public.discord_link_requests where token_hash=$1",[hash])).rows;
            const op=history[0].operation_id;
            const form=new FormData(); form.set("provider","discord"); form.set("operationId",op);
            if(acknowledged) await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?discord=recovered");
            current=changed;
            let view=await mount();
            try { expect(view.container.textContent).toContain("historical Discord attempt"); expect(view.container.textContent).not.toContain("Recover Discord result"); }
            finally { await view.close(); }
            const failed=await handler(new Request("https://fixture.invalid",{method:"POST",headers:{Authorization:"Bearer synthetic-jwt"},body:JSON.stringify({operation:"discord-confirm",token:authority})}));
            expect(failed.status).toBe(503);
            const owner=accountId; accountId=crypto.randomUUID(); await db.query("insert into auth.users values($1)",[accountId]);
            await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?recovery=unavailable"); accountId=owner;
            loseRetirement=true;
            await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?recovery=unavailable");
            view=await mount();
            try {
                expect(view.container.textContent).toContain("already acknowledged");
                expect(view.container.textContent).not.toContain("Recover Discord result");
                expect(view.container.textContent?.includes("Confirm and connect Discord")).toBe(changed===null);
                expect(view.container.textContent).toContain("My Servers");
            } finally { await view.close(); }
            await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?discord=retired");
            if(changed===null) {
                await expect(linkDiscordAccount(new FormData())).rejects.toThrow("redirect:https://discord.com/oauth2/authorize");
                const next=mocks.jar.get("__Host-account-link"); expect(next).not.toBe(authority);
                await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/account?recovery=unavailable"); expect(mocks.jar.get("__Host-account-link")).toBe(next);
                expect((await db.query("select acknowledged,operation_id from public.membership_recovery_intents where account_id=$1 and provider='discord'",[accountId])).rows[0]).toEqual({acknowledged:false,operation_id:expect.not.stringMatching(op)});
            }
            expect((await db.query("select * from public.discord_link_requests where token_hash=$1",[hash])).rows).toEqual(history);
        }
    } finally { await db.end(); }
}, 20000);

it("closed contention retry retains exact UUID and both cookies across confirmation, resolution and callback refusal", async()=>{
    mocks.jar.set("__Host-patreon-completion",token);mocks.jar.set("__Host-account-link",token);
    mocks.invoke.mockImplementation(async()=>({data:null,error:{context:Response.json({error:"membership_retry"},{status:503})}}));
    await expect(completePatreonAccount()).rejects.toThrow("patreon=retry");await expect(confirmDiscordAccount()).rejects.toThrow("discord=retry");
    const form=new FormData();form.set("provider","discord");form.set("operationId",operationId);
    await expect(resolveAccountLink(form)).rejects.toThrow("recovery=retry");expect(mocks.invoke).toHaveBeenLastCalledWith("website-account",expect.objectContaining({body:{operation:"recovery-resolve",provider:"discord",operationId}}));
    expect(mocks.jar.get("__Host-patreon-completion")).toBe(token);expect(mocks.jar.get("__Host-account-link")).toBe(token);
    pageResponses(bound());const view=await mount({discord:"retry"});try{expect(view.container.textContent).toContain("account is busy");expect(view.container.textContent).toContain("Confirm Discord connection");}finally{await view.close();}
    mocks.invoke.mockResolvedValue({data:{valid:true},error:null});mocks.user.mockResolvedValue({data:{user:{id:a,identities:[{provider:"discord",identity_data:{provider_id:"123456789012345678"}}]}}});
    mocks.stamp.mockResolvedValue({data:null,error:{code:"55P03",message:"private"}});
    const response=await discordCallback(new NextRequest("https://website.example/account/discord/callback?code=synthetic",{headers:{cookie:`__Host-account-link=${token}`}}));
    expect(response.headers.get("location")).toContain("discord=retry");expect(response.headers.has("set-cookie")).toBe(false);
});
