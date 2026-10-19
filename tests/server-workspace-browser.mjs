// Real Next/React streaming regression; only file data and unrelated log controls are fixtures.
// Run with: node tests/server-workspace-browser.mjs (installed headless Chromium required).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const root = process.cwd();
const fixture = await mkdtemp(resolve("node_modules/.workspace-browser-"));
const probe = createServer();
await new Promise(done => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const base = `http://127.0.0.1:${port}`;
let server, browser, log = "";
async function write(path, value) { await mkdir(dirname(join(fixture, path)), { recursive: true }); await writeFile(join(fixture, path), value); }
try {
    for (const path of ["src/app/components/servers/ServerManagementWorkspace.tsx", "src/app/cheats/commands.json", "src/app/cheats/debugOnly.ts"]) {
        await mkdir(dirname(join(fixture, path)), { recursive: true }); await copyFile(path, join(fixture, path));
    }
    await write("package.json", JSON.stringify({ private: true }));
    await write("next.config.mjs", `export default {devIndicators:false,transpilePackages:[${JSON.stringify(basename(fixture))}],webpack(config){config.resolve.alias['@']=${JSON.stringify(join(fixture, "src"))};return config;}}`);
    await write("src/app/components/servers/DownloadServerLogButton.tsx", 'export function DownloadServerLogButton(){return <button disabled>Download logs</button>}');
    await write("src/app/layout.tsx", 'export default function Layout({children}){return <html><body>{children}</body></html>}');
    await write("src/app/page.tsx", `import {Suspense} from 'react';
import {ServerManagementWorkspace,ServerWorkspacePanel} from './components/servers/ServerManagementWorkspace';
export const dynamic='force-dynamic';
async function Files(){await new Promise(done=>setTimeout(done,700));return <><ServerWorkspacePanel section="Save & config"><h2>Campaign save</h2><input aria-label="Import draft" defaultValue="" /></ServerWorkspacePanel><ServerWorkspacePanel section="Backups"><h2>Backups and restore</h2></ServerWorkspacePanel></>}
export default async function Page({searchParams}){const {initial}=await searchParams;return <ServerManagementWorkspace name="Streaming server" summary="Running" initialSection={initial === "settings" ? "Settings" : "Console"}><ServerWorkspacePanel section="Console"><h2>Console content</h2></ServerWorkspacePanel><ServerWorkspacePanel section="Settings"><h2>Server settings</h2></ServerWorkspacePanel><Suspense fallback={<ServerWorkspacePanel section="Save & config"><p>Loading files</p></ServerWorkspacePanel>}><Files /></Suspense></ServerManagementWorkspace>}`);
    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: fixture, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", data => { log += data; }); server.stderr.on("data", data => { log += data; });
    for (let n = 0; ; n++) { try { if ((await fetch(base)).ok) break; } catch {} if(n>100) throw new Error(log); await new Promise(done=>setTimeout(done,100)); }
    browser = await chromium.launch({ headless: true, ...(process.env.WORKSPACE_CHROMIUM ? { executablePath: process.env.WORKSPACE_CHROMIUM } : {}) });
    const page = await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',message=>{if(message.type()==='error' && message.text().includes('hydrat')) errors.push(message.text());});
    for (const initial of ["console", "settings"]) for (const [hash, heading] of [["server-files", "Campaign save"], ["server-backups", "Backups and restore"], ["server-visibility", "Server settings"]]) {
        await page.goto(`${base}/?initial=${initial}#${hash}`); await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole("heading", { name: "Console content" }).isVisible(), false);
        console.log(`PASS cold #${hash} from ${initial}: selected panel visible after streamed content arrives`);
    }
    await page.getByRole("button", { name: "Save & config", exact: true }).click();
    await page.getByLabel("Import draft").fill("Retain this draft");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await page.getByLabel("Import draft").isVisible(), false);
    await page.getByRole("button", { name: "Save & config", exact: true }).click();
    assert.equal(await page.getByLabel("Import draft").inputValue(), "Retain this draft");
    assert.deepEqual(errors, []);
    console.log("PASS ordinary navigation preserves mounted drafts; no browser errors");
} catch (error) { console.error(log); throw error; }
finally { await browser?.close(); if(server && server.exitCode === null && server.signalCode === null){const exited=new Promise(done=>server.once('exit',done));server.kill();await exited;} await rm(fixture,{recursive:true,force:true}); }
