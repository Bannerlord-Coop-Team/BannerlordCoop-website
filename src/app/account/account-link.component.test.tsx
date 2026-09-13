import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), unlink: vi.fn(), invoke: vi.fn(), link: vi.fn(), exchange: vi.fn(), user: vi.fn(), session: vi.fn(), admin: vi.fn(), stamp: vi.fn(), jar: new Map<string,string>() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.client }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: (key:string) => mocks.jar.has(key), get: (key:string) => mocks.jar.has(key) ? { value: mocks.jar.get(key) } : undefined, set: (key:string,value:string) => mocks.jar.set(key,value), delete: (key:string) => mocks.jar.delete(key) }) }));
import { disconnectDiscordAccount, disconnectPatreonAccount, linkDiscordAccount } from "./actions";
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/app/account/AccountStatusSync", () => ({ AccountStatusSync: () => null }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
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
function discordRequest() {
    return new NextRequest("https://website.example/account/discord/callback?code=synthetic", { headers: { cookie: `__Host-account-link=${token}` } });
}
function linkedUser(id = a) {
    return { data: { user: { id, identities: [{ provider: "discord", identity_data: { provider_id: "123456789012345678" } }] } } };
}
it("Discord callback attests same-account PKCE then immediately invokes authenticated Edge commit", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { valid: true }, error: null }).mockResolvedValueOnce({ data: { confirmed: true, returnPath: "/servers" }, error: null });
    mocks.user.mockResolvedValue(linkedUser());
    const response = await discordCallback(discordRequest());
    expect(response.headers.get("location")).toBe("https://website.example/servers");
    expect(mocks.stamp).toHaveBeenCalledWith("membership_discord_callback", expect.objectContaining({ p_account_id: a, p_discord_user_id: "123456789012345678" }));
    expect(mocks.invoke).toHaveBeenLastCalledWith("website-account", { headers: { Authorization: "Bearer synthetic-jwt" }, body: { operation: "discord-confirm", token }, timeout: 10_000 });
    expect(mocks.stamp.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[1]);
    expect(response.headers.get("set-cookie")).toBeNull();
});
it.each(["exchange", "account", "session", "stamp", "commit"])("Discord callback fails closed at %s without a manual confirmation", async scenario => {
    mocks.invoke.mockResolvedValue({ data: { valid: true }, error: null });
    mocks.user.mockResolvedValue(linkedUser());
    if (scenario === "exchange") mocks.exchange.mockResolvedValue({ error: new Error("failed") });
    if (scenario === "account") mocks.user.mockResolvedValueOnce(linkedUser()).mockResolvedValue(linkedUser("other"));
    if (scenario === "session") mocks.session.mockResolvedValueOnce({ data: { session: { user: { id: a }, access_token: "jwt" } } }).mockResolvedValue({ data: { session: { user: { id: "other" }, access_token: "other-jwt" } } });
    if (scenario === "stamp") mocks.stamp.mockResolvedValue({ data: null, error: new Error("unknown") });
    if (scenario === "commit") mocks.invoke.mockResolvedValueOnce({ data: { valid: true }, error: null }).mockResolvedValueOnce({ data: null, error: new Error("response lost") });
    expect((await discordCallback(discordRequest())).headers.get("location")).toContain("discord=repair");
    expect(mocks.invoke).toHaveBeenCalledTimes(scenario === "commit" ? 2 : 1);
    if (["exchange", "account", "session"].includes(scenario)) expect(mocks.stamp).not.toHaveBeenCalled();
});
it("Patreon callback immediately commits via current account JWT and duplicate callbacks retry the exact token", async () => {
    mocks.invoke.mockResolvedValue({ data: { linked: true, returnPath: "/servers" }, error: null });
    for (let i = 0; i < 2; i++) {
        const response = await patreonCallback(new NextRequest(`https://website.example/account/patreon/callback?token=${token}`));
        expect(response.headers.get("location")).toBe("https://website.example/servers");
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith("patreon-complete", { headers: { Authorization: "Bearer synthetic-jwt" }, body: { token }, timeout: 10_000 });
});
it.each(["anonymous", "session", "invalid", "foreign", "expired", "failure", "redirect"])("Patreon callback rejects %s without storing browser completion authority", async scenario => {
    mocks.invoke.mockResolvedValue({ data: { linked: true, returnPath: "/servers" }, error: null });
    if (scenario === "anonymous") mocks.user.mockResolvedValue({ data: { user: null } });
    if (scenario === "session") mocks.session.mockResolvedValue({ data: { session: { user: { id: "other" } } } });
    if (["foreign", "expired", "failure"].includes(scenario)) mocks.invoke.mockResolvedValue({ data: null, error: new Error("refused") });
    if (scenario === "redirect") mocks.invoke.mockResolvedValue({ data: { linked: true, returnPath: "https://attacker.invalid" }, error: null });
    const response = await patreonCallback(new NextRequest(`https://website.example/account/patreon/callback?token=${scenario === "invalid" ? "bad" : token}`));
    expect(response.headers.get("location")).toBe("https://website.example/account?patreon=error");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(["anonymous", "session", "invalid"].includes(scenario) ? 0 : 1);
});
it("account switch before Discord callback cannot exchange OAuth code or complete", async () => {
    mocks.invoke.mockResolvedValue({ error: new Error("initiator mismatch"), data: null });
    const request = new NextRequest("https://website.example/account/discord/callback?code=synthetic", { headers: { cookie: `__Host-account-link=${token}` } });
    const response = await discordCallback(request);
    expect(response.headers.get("location")).toBe("https://website.example/account?discord=repair"); expect(mocks.exchange).not.toHaveBeenCalled();
});
