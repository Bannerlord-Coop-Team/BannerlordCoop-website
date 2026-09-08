import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), invoke: vi.fn(), link: vi.fn(), exchange: vi.fn(), user: vi.fn(), session: vi.fn(), admin: vi.fn(), stamp: vi.fn(), jar: new Map<string,string>() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: (key:string) => mocks.jar.has(key), get: (key:string) => mocks.jar.has(key) ? { value: mocks.jar.get(key) } : undefined, set: (key:string,value:string) => mocks.jar.set(key,value), delete: (key:string) => mocks.jar.delete(key) }) }));
import { linkDiscordAccount, completePatreonAccount, confirmDiscordAccount, resolveAccountLink } from "./actions";
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
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
    mocks.client.mockResolvedValue({ auth: { getUser: mocks.user, getSession: mocks.session, linkIdentity: mocks.link, exchangeCodeForSession: mocks.exchange }, functions: { invoke: mocks.invoke } });
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
    await expect(completePatreonAccount()).rejects.toThrow("redirect:/servers?patreon=linked"); expect(mocks.jar.has("__Host-patreon-completion")).toBe(false);
    expect(mocks.invoke.mock.calls.every(call=>call[1].body.token===token)).toBe(true);
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
        expect(view.container.textContent).toContain("Continue to Servers");
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
    mocks.invoke.mockResolvedValue({ data: bound("committed"), error: null }); await expect(resolveAccountLink(form)).rejects.toThrow("redirect:/servers?discord=recovered"); expect(mocks.jar.has("__Host-account-link")).toBe(false);
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
