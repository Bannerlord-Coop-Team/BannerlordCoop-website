// Real Next server actions, cookies, navigation and user UI; Auth/data are local fixtures.
// No production credentials, network services, or target-user sessions are used.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, cp, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { createHmac } from "node:crypto";
import { chromium } from "@playwright/test";

const root = process.cwd();
const fixture = await mkdtemp(resolve("node_modules/.impersonation-browser-"));
const probe = createServer();
await new Promise(done => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const base = `https://127.0.0.1:${port}`;
const adminId = "11111111-1111-4111-8111-111111111111";
const aliceId = "22222222-2222-4222-8222-222222222222";
const bobId = "33333333-3333-4333-8333-333333333333";
const loginId = "44444444-4444-4444-8444-444444444444";
const secret = "isolated-browser-impersonation-key";
let server, browser, log = "";
async function write(path, value) { await mkdir(dirname(join(fixture, path)), { recursive: true }); await writeFile(join(fixture, path), value); }
try {
    await cp("src", join(fixture, "src"), { recursive: true });
    await cp("supabase/functions/_shared", join(fixture, "supabase/functions/_shared"), { recursive: true });
    await copyFile("postcss.config.mjs", join(fixture, "postcss.config.mjs"));
    await write("package.json", JSON.stringify({ name: basename(fixture), private: true }));
    await write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], jsx: "preserve", module: "esnext", moduleResolution: "bundler", esModuleInterop: true, allowJs: true, skipLibCheck: true, paths: { "@/*": ["./src/*"] } } }));
    await write("next.config.mjs", `export default {devIndicators:false,transpilePackages:[${JSON.stringify(basename(fixture))}],webpack(config){config.resolve.alias['@']=${JSON.stringify(join(fixture, "src"))};config.resolve.alias['@supabase/ssr']=${JSON.stringify(join(fixture, "fixture-auth.ts"))};return config;}}`);
    const users = [[adminId, "Administrator", "Admin"], [aliceId, "Alice", "Standard Server"], [bobId, "Bob", "User"]].map(([id, name, role]) => ({ id, aud: "authenticated", role: "authenticated", email: `${name.toLowerCase()}@example.invalid`, created_at: "2026-09-01T00:00:00.000Z", app_metadata: { role }, user_metadata: { name }, identities: [] }));
    const token = `e30.${Buffer.from(JSON.stringify({ session_id: loginId })).toString("base64url")}.fixture`;
    await write("fixture-auth.ts", `export const users=${JSON.stringify(users)};
export function createServerClient(){return {auth:{getUser:async()=>({data:{user:users[0]},error:null}),getSession:async()=>({data:{session:{user:users[0],access_token:${JSON.stringify(token)},refresh_token:'fixture-refresh'}},error:null})},functions:{invoke:async(name,options)=>({error:null,data:{version:1,accountId:options.body.accountId??users[0].id,hasDiscord:false,configured:true,verificationPending:false,membership:{linked:false,verification:'unverified',sync:'not_needed',verifiedAt:null,validUntil:null,retryAt:null,refreshMode:'oauth_reauthorization'}}})}}}
export const createBrowserClient=createServerClient;`);
    await write("src/app/lib/supabase/admin.ts", `import {users} from '../../../../fixture-auth';export function getSupabaseAdminClient(){return {auth:{admin:{getUserById:async(id)=>({data:{user:users.find(user=>user.id===id)},error:null}),listUsers:async()=>({data:{users},error:null})}}};}`);
    await write("src/app/lib/control-plane/client.ts", `import {users} from '../../../../fixture-auth';
export class ControlPlaneAdminError extends Error{}
export async function requestControlPlaneAdmin(options){if(options.operation!=='view-as-user')throw new Error('Unexpected administrator call');const user=users.find(user=>user.id===options.input.accountId);const request=options.input.request;
if(request.operation==='my-servers')return {items:[{serverId:user.id,displayName:user.user_metadata.name+' campaign',accessRole:'owner',friendlyRegion:'germany',operationState:'stopped',observedGameState:'stopped',releaseChannel:'stable',visibility:'private',connectionIp:null,gamePorts:[],updatedAt:'2026-09-01T00:00:00.000Z'}],nextCursor:null};
if(request.operation==='server-onboarding')throw new Error('No allocation fixture');throw new Error('Unexpected preview request');}`);
    await write("src/app/lib/hosting/public-servers.ts", "export async function listPublicServers(){return []}");
    await write("src/app/lib/hosting/server-settings.ts", "export async function getServerDisplayNames(){return new Map()}");
    await write("src/app/layout.tsx", `import {ImpersonationBanner} from '@/app/components/admin/ImpersonationBanner';import './globals.css';export default function Layout({children}){return <html><body><ImpersonationBanner/>{children}</body></html>}`);
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(fixture, "key.pem"), "-out", join(fixture, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port), "--experimental-https", "--experimental-https-key", join(fixture, "key.pem"), "--experimental-https-cert", join(fixture, "cert.pem")], {
        cwd: fixture, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_EXTRA_CA_CERTS: join(fixture, "cert.pem"), NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "isolated-publishable-fixture-key", SUPABASE_SECRET_KEY: secret }, stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", data => { log += data; }); server.stderr.on("data", data => { log += data; });
    browser = await chromium.launch({ headless: true, ...(process.env.WORKSPACE_CHROMIUM ? { executablePath: process.env.WORKSPACE_CHROMIUM } : {}) });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    // Only the disposable website may receive browser traffic.
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    for (let attempt = 0; ; attempt++) {
        try { await page.goto(`${base}/admin`); if (await page.getByRole("heading", { name: "Member Administration" }).isVisible()) break; } catch { /* bounded startup */ }
        if (attempt > 50 || server.exitCode !== null) throw new Error(log);
        await new Promise(done => setTimeout(done, 200));
    }
    await page.getByRole("button", { name: "View as Alice", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Viewing as Alice" }).waitFor();
    await page.getByText("Alice campaign", { exact: true }).waitFor();
    assert.equal(await page.getByText("Bob campaign", { exact: true }).count(), 0);
    const selection = (await context.cookies()).find(cookie => cookie.name === "__Host-view-as-user");
    assert.ok(selection?.httpOnly && selection.secure && selection.sameSite === "Lax");
    await page.goto(`${base}/account`);
    await page.getByRole("status").filter({ hasText: "Viewing as Alice" }).waitFor();
    assert.ok((await page.textContent("main")).includes("Alice"));
    console.log("PASS Alice identity, owner inventory, account navigation, and secure HttpOnly selection");
    await page.getByRole("button", { name: "Exit impersonation" }).click();
    await page.getByRole("heading", { name: "Member Administration" }).waitFor();
    await page.locator("#impersonation-banner").waitFor({ state: "detached" });
    assert.equal(await page.locator("#impersonation-banner").count(), 0);
    await page.getByRole("button", { name: "View as Bob", exact: true }).click();
    await page.getByText("Bob campaign", { exact: true }).waitFor();
    assert.equal(await page.getByText("Alice campaign", { exact: true }).count(), 0);
    console.log("PASS exit preserves administrator access; switching users does not reuse the previous inventory");
    const issuedAt = Date.now() - 31 * 60_000;
    const payload = Buffer.from(JSON.stringify({ id: loginId, actorId: adminId, actorSessionId: loginId, targetId: bobId, issuedAt, expiresAt: issuedAt + 30 * 60_000 })).toString("base64url");
    const signature = createHmac("sha256", secret).update(`website-view-as-user:v1:${payload}`).digest("base64url");
    await context.addCookies([{ name: "__Host-view-as-user", value: `${payload}.${signature}`, url: base, secure: true, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/account`);
    await page.getByRole("status").filter({ hasText: "Impersonation expired or unavailable" }).waitFor();
    await page.getByRole("button", { name: "Exit impersonation" }).click();
    await page.getByRole("heading", { name: "Member Administration" }).waitFor();
    await page.locator("#impersonation-banner").waitFor({ state: "detached" });
    assert.equal(await page.locator("#impersonation-banner").count(), 0);
    console.log("PASS expired selections retain a visible exit and cannot silently become an administrator view");
} catch (error) { console.error(log); throw error; }
finally {
    await browser?.close();
    if (server && server.exitCode === null && server.signalCode === null) { const exited = new Promise(done => server.once("exit", done)); server.kill(); await exited; }
    await rm(fixture, { recursive: true, force: true });
}
