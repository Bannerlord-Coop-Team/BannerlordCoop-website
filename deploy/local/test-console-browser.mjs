import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Exercises the running local stack without mocking Auth, Server Actions, Edge or the control plane.
const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.match(manifest.serverId, /^[\da-f-]{36}$/i);
assert.equal(typeof manifest.command, "string");
assert.equal(typeof manifest.expectedOutput, "string");
assert.match(manifest.tlsSpki, /^[A-Za-z0-9+/]{43}=$/);
const fixture = JSON.parse(await readFile(new URL("./dev-login/fixture.json", import.meta.url), "utf8"));
const artifacts = resolve(process.argv[3] ?? (process.platform === "win32" ? "G:/.pi-tmp/local-console-browser" : "/mnt/g/.pi-tmp/local-console-browser"));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP supabase-tls.localhost 127.0.0.1", `--ignore-certificate-errors-spki-list=${manifest.tlsSpki}`] });
const page = await browser.newPage();
page.setDefaultTimeout(90_000);
const evidence = { accountId: fixture.accountId, serverId: manifest.serverId, command: manifest.command, signedInWithoutDiscord: false, outputMatched: false, acknowledged: false };
try {
    // Restrict browser traffic to the disposable website and Supabase gateway.
    await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (["https://supabase-tls.localhost:3443", "https://supabase-tls.localhost:8443"].includes(url.origin)) return route.continue();
        return route.abort();
    });
    await page.goto("https://supabase-tls.localhost:3443/dev-login", { waitUntil: "commit" });
    // The local SSR form is visible before React attaches its password handler.
    await page.waitForFunction(() => {
        const form = document.querySelector("form");
        return form && Object.keys(form).some(key => key.startsWith("__reactProps$") && typeof form[key]?.onSubmit === "function");
    });
    const authentication = page.waitForResponse(response => response.url().includes("/auth/v1/token") && response.request().method() === "POST");
    await page.getByLabel("Email", { exact: true }).fill(fixture.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
    const response = await authentication;
    assert.equal(response.status(), 200);
    const { user } = await response.json();
    assert.equal(user.id, fixture.accountId);
    assert.ok(Array.isArray(user.identities));
    assert.ok(user.identities.every(identity => identity.provider !== "discord"));
    evidence.signedInWithoutDiscord = true;
    // Streamed inventory and dev resources need not finish loading before opening the target server.
    await page.waitForURL("https://supabase-tls.localhost:3443/servers", { waitUntil: "commit" });
    await page.goto(`https://supabase-tls.localhost:3443/servers/${manifest.serverId}`, { waitUntil: "commit" });
    await page.getByLabel("Game command", { exact: true }).fill(manifest.command);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Acknowledge result", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Command result", { exact: true }).textContent(), manifest.expectedOutput);
    evidence.outputMatched = true;
    await page.getByRole("button", { name: "Acknowledge result", exact: true }).click();
    await page.getByRole("button", { name: "New command", exact: true }).waitFor();
    evidence.acknowledged = true;
    await page.screenshot({ path: resolve(artifacts, "acknowledged.png"), fullPage: true });
    console.log("Local browser sign-in, exact command result and acknowledgement passed. Correlate CP runner receipt separately.");
} catch (error) {
    await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
} finally {
    await writeFile(resolve(artifacts, "browser-evidence.json"), JSON.stringify(evidence, null, 2));
    await browser.close();
}
