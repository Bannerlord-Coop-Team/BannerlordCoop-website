import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), invoke: vi.fn(), link: vi.fn(), exchange: vi.fn(), user: vi.fn(), session: vi.fn(), jar: new Map<string,string>() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key:string) => mocks.jar.has(key) ? { value: mocks.jar.get(key) } : undefined, set: (key:string,value:string) => mocks.jar.set(key,value), delete: (key:string) => mocks.jar.delete(key) }) }));
import { linkDiscordAccount, completePatreonAccount, confirmDiscordAccount } from "./actions";
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
    expect(mocks.jar.has("__Host-account-link")).toBe(false);
});
it("account switch before Discord callback cannot exchange OAuth code or complete", async () => {
    mocks.invoke.mockResolvedValue({ error: new Error("initiator mismatch"), data: null });
    const request = new NextRequest("https://website.example/account/discord/callback?code=synthetic", { headers: { cookie: `__Host-account-link=${token}` } });
    const response = await discordCallback(request);
    expect(response.headers.get("location")).toBe("https://website.example/account?discord=repair"); expect(mocks.exchange).not.toHaveBeenCalled();
});
it("Discord callback requires same UUID both before and after Supabase code exchange, explicit confirmation follows", async () => {
    mocks.invoke.mockResolvedValue({ data: { valid: true }, error: null });
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
