// Explicitly invoked MOCK-ONLY visual integration test. No production route is modified.
// Requires an explicitly approved installed Chromium (default: Windows Edge).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const owned = await mkdtemp(resolve("node_modules/.onboarding-focus-browser-"));
console.log(`Owned mock-only evidence: ${owned}`);
const source = join(owned, "source");
const profile = join(owned, "profile");
const port = 43187;
const base = `http://127.0.0.1:${port}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"].includes(key.toUpperCase())));
Object.assign(env, { NEXT_TELEMETRY_DISABLED: "1", HOME: join(owned, "home"), USERPROFILE: join(owned, "home") });
await new Promise((yes, no) => { const probe = createServer(); probe.once("error", no); probe.listen(port, "127.0.0.1", () => probe.close(yes)); });
await mkdir(source, { recursive: true }); await mkdir(env.HOME, { recursive: true });
for (const path of ["src/app/components/servers/ServerOnboarding.tsx", "src/app/components/servers/ServerDirectoryTable.tsx", "src/app/servers/onboarding-intent.ts", "supabase/functions/_shared/server-onboarding-contract.ts", "tests/onboarding-fixtures.ts", "src/app/globals.css", "postcss.config.mjs", "tsconfig.json"]) {
    await mkdir(dirname(join(source, path)), { recursive: true }); await copyFile(path, join(source, path));
}
await writeFile(join(source, "package.json"), JSON.stringify({ private: true, dependencies: { next: "16.3.3", react: "19.2.8", "react-dom": "19.2.8" } }));
await writeFile(join(source, "next.config.mjs"), `export default { devIndicators: false, transpilePackages: [${JSON.stringify(basename(owned))}], outputFileTracingRoot: ${JSON.stringify(source)}, webpack(config) { config.resolve.alias['@'] = ${JSON.stringify(join(source, "src"))}; return config; } };`);
await writeFile(join(source, "src/app/page.tsx"), (await readFile("tests/onboarding-browser-fixture.tsx", "utf8")).replace('"./onboarding-fixtures"', '"../../tests/onboarding-fixtures"'));
await writeFile(join(source, "src/app/layout.tsx"), `import './globals.css'; export default function Layout({children}) { return <html lang="en"><body>{children}</body></html>; }`);
await writeFile(join(source, "src/app/servers/onboarding-actions.ts"), `// MOCK-ONLY: disposable browser fixture, never deployed.
import { onboardingCreated, onboardingRequested } from '../../../tests/onboarding-fixtures';
export async function submitServerOnboarding(input, expectedUser) {
 const calls = JSON.parse(sessionStorage.getItem('fixture-calls') || '[]'); calls.push(input); sessionStorage.setItem('fixture-calls', JSON.stringify(calls));
 const mode = sessionStorage.getItem('fixture-response');
 if (mode === 'pending') await new Promise(resolve => window.addEventListener('fixture-resolve-pending', resolve, {once:true}));
 else await new Promise(resolve => setTimeout(resolve, 120));
 if (expectedUser !== (sessionStorage.getItem('fixture-auth-user') || 'account-a')) return {ok:false,retrySameRequest:true,message:'Mock authenticated account changed. Retry with the original account.'};
 if (mode === 'lost') return {ok:false,retrySameRequest:true,message:'Mock response lost after possible commit. Retry pending request.'};
 if (mode === 'race') return {ok:false,retrySameRequest:false,message:'No change was made by this request. Mock capacity changed; refresh before choosing again.'};
 if(input.action === 'create-server') sessionStorage.setItem('fixture-created','yes'); else sessionStorage.setItem('fixture-requested','yes');
 window.dispatchEvent(new Event('fixture-update'));
 return {ok:true,result: input.action === 'create-server' ? {...onboardingCreated(),displayName:input.displayName,region:input.region} : {...onboardingRequested(),request:{...onboardingRequested().request,region:input.region}}};
}`);
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: source, env: { ...env, NODE_OPTIONS: `--require="${join(root, "tests/onboarding-offline-build.cjs").replaceAll("\\", "/")}"` }, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = ""; server.stdout.on("data", (v) => { serverLog += v; }); server.stderr.on("data", (v) => { serverLog += v; });
let browser; let ws;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
    for (let n = 0; n < 100; n++) { try { if ((await fetch(base)).ok) break; } catch {} await wait(300); if (n === 99) throw new Error("Owned mock server did not become ready"); }
    browser = spawn(process.env.ONBOARDING_CHROMIUM || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--disable-crash-reporter", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--metrics-recording-only", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { env: { ...env, LOCALAPPDATA: join(owned, "home"), APPDATA: join(owned, "home") }, stdio: ["ignore", "pipe", "pipe"] });
    browser.stderr.on("data", (value) => { serverLog += `BROWSER: ${value}`; });
    browser.on("error", (error) => { serverLog += `BROWSER: ${error.message}`; });
    let debugPort;
    for (let n = 0; n < 100; n++) { try { debugPort = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch {} await wait(100); }
    assert.ok(debugPort, "Fresh owned browser debugger");
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    ws = new WebSocket(targets.find((entry) => entry.type === "page").webSocketDebuggerUrl);
    await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = no; });
    let id = 0; const callbacks = new Map(); const blocked = []; const errors = []; const pageTraffic = [];
    function cdp(method, params = {}) { return new Promise((yes, no) => { const key = ++id; callbacks.set(key, { yes, no }); ws.send(JSON.stringify({ id: key, method, params })); }); }
    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.id) { const cb = callbacks.get(message.id); callbacks.delete(message.id); if (message.error) cb.no(new Error(JSON.stringify(message.error))); else cb.yes(message.result); }
        if (message.method === "Fetch.requestPaused") {
            const url = message.params.request.url;
            pageTraffic.push(url);
            if (url.startsWith(base + "/") || url === base) await cdp("Fetch.continueRequest", { requestId: message.params.requestId });
            else { blocked.push(url); await cdp("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" }); }
        }
        if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    };
    await cdp("Runtime.enable"); await cdp("Page.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const evaluate = async (expression) => { const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    async function until(expression) { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await wait(80); } throw new Error(`Browser assertion timeout: ${expression}`); }
    const click = async (text) => { await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`); await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}); b.focus(); b.click();})()`); await wait(100); };
    const setName = async () => { await evaluate(`(()=>{const i=document.querySelector('#onboarding-server-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'My Campaign');i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(80); };
    const setFixture = async (key, value) => evaluate(`sessionStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)})`);
    const screenshot = async (file) => {
        await evaluate(`(()=>{const tag=document.createElement('div');tag.id='mock-screenshot-label';tag.textContent='MOCK ONLY · synthetic auth/API · no real server';tag.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#48200e;color:#fff;text-align:center;font:12px/20px sans-serif;pointer-events:none';(document.querySelector('dialog')||document.body).append(tag);})()`);
        const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(owned, file), Buffer.from(shot.data, "base64"));
        await evaluate(`document.getElementById('mock-screenshot-label').remove()`);
    };
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const navigation = await cdp("Page.navigate", { url: base }); assert.equal(navigation.errorText, undefined, "Loopback fixture navigation"); await until(`document.body.textContent.includes('You have a server available')`);
    await screenshot("mock-desktop-banner.png"); await click("Set up server");
    await until(`document.querySelector('dialog')?.open && document.activeElement.id==='onboarding-server-name'`);
    await screenshot("mock-desktop-dialog.png");
    await evaluate(`document.querySelector('[aria-label="Close server setup"]').focus()`);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8, windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate(`document.activeElement.textContent.trim()`), "Create server");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until(`!document.querySelector('dialog')`); assert.equal(await evaluate(`document.activeElement.textContent.trim()`), "Set up server");
    for (const mode of ["pending", "lost"]) for (const dismiss of ["Escape", "Close"]) {
        await click("Reset mock"); await setFixture("fixture-response", mode);
        await click("Set up server"); await setName(); await click("Create server");
        await until(mode === "pending" ? `document.body.textContent.includes('Close (request continues)')` : `document.body.textContent.includes('Mock response lost')`);
        const retained = await evaluate(`sessionStorage.getItem('server-onboarding-intent:v1:account-a')`);
        assert.ok(retained);
        assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Set up server').disabled`), true);
        if (dismiss === "Escape") await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        else {
            const label = mode === "pending" ? "Close (request continues)" : "Close";
            const point = await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()===${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
            await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
            await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
        }
        await until(`!document.querySelector('dialog')`);
        assert.equal(await evaluate(`document.activeElement === document.querySelector('#available-server-heading').closest('section').parentElement`), true, `${mode} ${dismiss}: safe fallback receives native focus`);
        assert.equal(await evaluate(`sessionStorage.getItem('server-onboarding-intent:v1:account-a')`), retained);
        assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('fixture-calls'))`), [JSON.parse(retained)], "Dismiss does not submit again");
        if (mode === "pending") {
            assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Confirming request…').disabled`), true);
            await evaluate(`window.dispatchEvent(new Event('fixture-resolve-pending'))`);
        } else { await setFixture("fixture-response", "success"); await click("Retry pending request"); }
        await until(`document.body.textContent.includes('Server assigned')`);
        assert.equal(await evaluate(`sessionStorage.getItem('server-onboarding-intent:v1:account-a')`), null);
        assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('fixture-calls'))`), Array.from({ length: mode === "pending" ? 1 : 2 }, () => JSON.parse(retained)));
        console.log(`PASS native focus: ${mode} ${dismiss}; exact intent retained; ${mode === "pending" ? "original request continued" : "exact retry"}`);
    }
    await click("Reset mock"); await click("Set up server"); await setName(); await click("Create server"); await until(`document.body.textContent.includes('Server assigned')`);
    await screenshot("mock-desktop-assigned.png"); await click("Done");
    await until(`document.body.textContent.includes('My Campaign') && document.body.textContent.includes('Offline')`);
    await click("Reset mock"); await click("Set up server"); await evaluate(`document.querySelector('input[value="france"]').click()`); await click("Request region");
    await until(`document.body.textContent.includes('Region request confirmed')`); await screenshot("mock-desktop-requested.png"); await click("Done");
    await cdp("Page.reload"); await until(`document.body.textContent.includes('France — request saved (outstanding)')`);
    await click("Reset mock"); await setFixture("fixture-response", "race"); await click("Set up server"); await setName(); await click("Create server");
    await until(`document.body.textContent.includes('No change was made')`); await screenshot("mock-desktop-capacity-race.png"); await click("Close");
    await click("Reset mock"); await setFixture("fixture-response", "lost"); await click("Set up server"); await setName(); await click("Create server");
    await until(`document.body.textContent.includes('Mock response lost')`); await click("Close");
    const original = await evaluate(`sessionStorage.getItem('server-onboarding-intent:v1:account-a')`);
    await cdp("Page.reload"); await until(`document.body.textContent.includes('Retry pending request')`); await click("consumed"); await click("Retry pending request");
    assert.equal(await evaluate(`sessionStorage.getItem('server-onboarding-intent:v1:account-a')`), original);
    await setFixture("fixture-auth-user", "account-b"); await click("Retry pending request"); await until(`document.body.textContent.includes('Mock authenticated account changed')`);
    await screenshot("mock-desktop-recovery.png");
    await click("Switch page account"); await until(`!document.body.textContent.includes('Retry pending request')`); await click("Switch page account"); await until(`document.body.textContent.includes('Retry pending request')`);
    await setFixture("fixture-auth-user", "account-a"); await setFixture("fixture-response", "success"); await click("Retry pending request"); await until(`document.body.textContent.includes('Server assigned')`);
    const calls = await evaluate(`JSON.parse(sessionStorage.getItem('fixture-calls'))`); for (const call of calls) assert.deepEqual(call, JSON.parse(original));
    await click("Reset mock");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await screenshot("mock-mobile-banner.png"); await click("Set up server");
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true);
    await screenshot("mock-mobile-dialog.png");
    await evaluate(`document.querySelector('input[value="france"]').click()`); await click("Request region"); await until(`document.body.textContent.includes('Region request confirmed')`);
    await screenshot("mock-mobile-requested.png"); await click("Done");
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    await writeFile(join(owned, "page-traffic.json"), JSON.stringify({ pageTraffic, blocked, errors }, null, 2));
    console.log("MOCK-ONLY browser checks passed: desktop/mobile, native dialog focus/Tab/Escape/restore including pending and uncertain Escape/Close, assigned stopped inventory, durable requested summary reload, capacity race, uncertain exact retry/reload/consumed quota/account mismatch and switch. Observed page traffic was loopback only; browser-internal egress isolation is not proved.");
    await cdp("Browser.close");
} finally {
    ws?.close();
    for (const child of [browser, server]) {
        if (!child || child.exitCode !== null) continue;
        if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { env, stdio: "ignore" });
        else child.kill();
    }
    await writeFile(join(owned, "server.log"), serverLog);
    await wait(1200);
    // Only owned fixture profile/state is removed; source and sanitized logs remain for review.
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rm(env.HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
