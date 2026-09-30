// Real Next server actions, cookies, navigation and user UI; Auth/data are local fixtures.
// No production credentials, network services, or target-user sessions are used.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, cp, mkdir, writeFile, readFile, rm, copyFile } from "node:fs/promises";
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
const secret = "isolated-browser-impersonation-key";
let server, browser, log = "";
async function write(path, value) { await mkdir(dirname(join(fixture, path)), { recursive: true }); await writeFile(join(fixture, path), value); }
try {
    await cp("src", join(fixture, "src"), { recursive: true });
    await cp("supabase/functions/_shared", join(fixture, "supabase/functions/_shared"), { recursive: true });
    await copyFile("postcss.config.mjs", join(fixture, "postcss.config.mjs"));
    await write("package.json", JSON.stringify({ name: basename(fixture), private: true }));
    await write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], jsx: "preserve", module: "esnext", moduleResolution: "bundler", esModuleInterop: true, allowJs: true, skipLibCheck: true, paths: { "@/*": ["./src/*"] } } }));
    await write("next.config.mjs", `export default {devIndicators:false,transpilePackages:[${JSON.stringify(basename(fixture))}],webpack(config){config.resolve.alias['@']=${JSON.stringify(join(fixture, "src"))};config.resolve.alias['@supabase/ssr']=${JSON.stringify(join(fixture, "fixture-auth.mjs"))};config.resolve.alias['@supabase/supabase-js']=${JSON.stringify(join(fixture, "fixture-auth.mjs"))};return config;}}`);
    await copyFile("tests/fixtures/impersonation-auth.mjs", join(fixture, "fixture-auth.mjs"));
    await write("src/app/lib/supabase/admin.ts", `export {getSupabaseAdminClient} from '../../../../fixture-auth.mjs';`);
    // Replace only the external transport; keep the real API parser and caller.
    await write("src/app/lib/hosting/my-servers.ts", 'import {fixtureFetch} from "../../../../fixture-auth.mjs";\n' + (await readFile("src/app/lib/hosting/my-servers.ts", "utf8")).replace("await fetch(endpoint,", "await fixtureFetch(endpoint,"));
    await write("src/app/fixture-state/route.ts", `import {fixtureResult} from '../../../fixture-auth.mjs';export function GET(){return Response.json(fixtureResult())}`);
    await write("src/app/lib/hosting/public-servers.ts", "export async function listPublicServers(){return []}");
    await write("src/app/lib/hosting/server-settings.ts", "export async function getServerDisplayNames(){return new Map()}");
    await write("src/app/layout.tsx", `import {ImpersonationBanner} from '@/app/components/admin/ImpersonationBanner';import './globals.css';export default function Layout({children}){return <html><body><ImpersonationBanner/>{children}</body></html>}`);
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(fixture, "key.pem"), "-out", join(fixture, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port), "--experimental-https", "--experimental-https-key", join(fixture, "key.pem"), "--experimental-https-cert", join(fixture, "cert.pem")], {
        cwd: fixture, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_EXTRA_CA_CERTS: join(fixture, "cert.pem"), NEXT_TELEMETRY_DISABLED: "1", ADMIN_IMPERSONATION_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "isolated-publishable-fixture-key", SUPABASE_SECRET_KEY: secret }, stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", data => { log += data; }); server.stderr.on("data", data => { log += data; });
    browser = await chromium.launch({ headless: true, ...(process.env.WORKSPACE_CHROMIUM ? { executablePath: process.env.WORKSPACE_CHROMIUM } : {}) });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    // Only the disposable website may receive browser traffic.
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const startupDeadline = Date.now() + 90_000;
    for (;;) {
        try { await page.goto(`${base}/admin`, { timeout: 15_000 }); if (await page.getByRole("heading", { name: "Member Administration" }).isVisible()) break; } catch { /* bounded startup */ }
        if (Date.now() > startupDeadline || server.exitCode !== null) throw new Error(log);
        await new Promise(done => setTimeout(done, 200));
    }
    await page.getByRole("button", { name: "Impersonate Alice", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Impersonating Alice" }).waitFor();
    await page.getByText("Alice campaign", { exact: true }).waitFor();
    assert.equal(await page.getByText("Bob campaign", { exact: true }).count(), 0);
    const selection = (await context.cookies()).find(cookie => cookie.name === "__Host-view-as-user");
    assert.ok(selection?.httpOnly && selection.secure && selection.sameSite === "Lax");
    const backup = (await context.cookies()).find(cookie => cookie.name === "__Host-impersonation-admin");
    assert.ok(backup?.httpOnly && backup.secure && backup.sameSite === "Lax");
    await page.goto(`${base}/account`);
    await page.getByRole("status").filter({ hasText: "Impersonating Alice" }).waitFor();
    assert.ok((await page.textContent("main")).includes("Alice"));
    await page.getByRole("button", { name: "Disconnect Patreon", exact: true }).click();
    await page.getByRole("button", { name: "Confirm disconnect Patreon", exact: true }).click();
    await page.getByRole("button", { name: "Connect Patreon", exact: true }).waitFor();
    const fixtureState = await (await context.request.get(`${base}/fixture-state`)).json();
    assert.deepEqual(fixtureState.unlinked, [aliceId]);
    assert.equal(fixtureState.events.some(event => event.action === "unlink" && event.userId === adminId), false);
    console.log("PASS native target identity, inventory, and real account mutation through the existing UI");
    await page.getByRole("link", { name: "Choose another user" }).click();
    await page.getByRole("button", { name: "Impersonate Bob", exact: true }).click();
    await page.getByText("Bob campaign", { exact: true }).waitFor();
    assert.equal(await page.getByText("Alice campaign", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Exit impersonation" }).click();
    await page.getByRole("heading", { name: "Member Administration" }).waitFor();
    await page.locator("#impersonation-banner").waitFor({ state: "detached" });
    assert.equal(await page.locator("#impersonation-banner").count(), 0);
    await page.getByRole("button", { name: "Impersonate Bob", exact: true }).click();
    await page.getByText("Bob campaign", { exact: true }).waitFor();
    assert.equal(await page.getByText("Alice campaign", { exact: true }).count(), 0);
    console.log("PASS exit preserves administrator access; switching users does not reuse the previous inventory");
    const issuedAt = Date.now() - 31 * 60_000;
    const current = (await context.cookies()).find(cookie => cookie.name === "__Host-view-as-user");
    const selected = JSON.parse(Buffer.from(current.value.split(".")[0], "base64url").toString());
    const payload = Buffer.from(JSON.stringify({ ...selected, issuedAt, expiresAt: issuedAt + 30 * 60_000 })).toString("base64url");
    const signature = createHmac("sha256", secret).update(`website-impersonation:v2:${payload}`).digest("base64url");
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
