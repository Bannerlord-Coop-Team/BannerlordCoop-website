import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ServerWireframe from "./ServerWireframe";
import { LocalizationProvider } from "@/app/lib/localization/client";
import messages from "@/app/lib/localization/dictionaries/en/server-wireframe.json";
import { createTranslator } from "@/app/lib/localization/translator";
import { assertDictionaryParity } from "@/app/lib/localization/integrity";
import { localeDefinitions } from "@/app/lib/localization/registry";
import type { Dictionary, Locale } from "@/app/lib/localization/types";

const request = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: request.locale }) }) }));
import ServerWireframePage, { generateMetadata } from "./page";

/** Supplies the same scoped dictionary boundary used by the public route. */
function Demo({ dictionary = messages, locale = "en" }: { dictionary?: Dictionary; locale?: Locale }) {
    return <LocalizationProvider locale={locale} messages={{ "server-wireframe": dictionary }}><ServerWireframe /></LocalizationProvider>;
}

test("public wireframe starts with a concealed address and clearly labeled demo console", () => {
    const html = renderToStaticMarkup(<Demo />);
    assert.match(html, /Public wireframe/);
    assert.match(html, /No live connections/);
    assert.match(html, /id="server-address"[^>]*>Hidden</);
    assert.match(html, /aria-controls="server-address" aria-expanded="false"/);
    assert.doesNotMatch(html, /203\.0\.113\.42/);
    assert.match(html, /Download logs/);
    assert.match(html, /aria-label="Demo server controls"/);
    assert.match(html, /title="Copy demo IP and port"/);
    assert.match(html, /Copy join address/);
    assert.match(html, /aria-label="Edit server name"/);
    assert.doesNotMatch(html, /Explore the controls|Watch the campaign|flex-col-reverse/);
    assert.match(html, /aria-expanded="false" aria-controls="command-picker"/);
    assert.match(html, /aria-label="Insert announce command"/);
    assert.doesNotMatch(html, /Welcome to the campaign!/);
    assert.equal((html.match(/>Information<\/h3>/g) ?? []).length, 1);
    assert.doesNotMatch(html, /4 \/ 8 players|Campaign day 126|Last saved 2 minutes ago/);
    assert.doesNotMatch(html, /Server management \/ UX exploration|Backups, restores and save transfers are simulated/);
    assert.match(html, /aria-label="Demo console output"/);
    for (const workspace of ["Console", "Backups", "Save &amp; config", "Settings"]) {
        assert.ok(html.includes(workspace));
    }
});

test("demo lifecycle confirms interruptions and keeps controls and status in sync", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
    const click = async (label: string) => { await act(async () => button(label).click()); };
    try {
        await act(async () => root.render(<Demo />));
        assert.equal(button("Start").disabled, true);
        await click("Stop");
        assert.ok(container.textContent?.includes("Running · demo"));
        assert.equal(document.activeElement, button("Cancel"));
        await click("Cancel");
        assert.equal(container.querySelector("#lifecycle-confirmation"), null);
        assert.ok(container.textContent?.includes("Running · demo"));
        await click("Restart");
        await click("Restart server");
        assert.ok(container.textContent?.includes("Demo server restarted."));
        assert.equal(button("Start").disabled, true);
        await click("Stop");
        await click("Stop server");
        assert.ok(container.textContent?.includes("Stopped · demo"));
        assert.equal(button("Start").disabled, false);
        assert.equal(button("Stop").disabled, true);
        assert.equal(button("Restart").disabled, true);
        assert.equal(button("Send").disabled, true);
        await click("Start");
        assert.ok(container.textContent?.includes("Running · demo"));
        assert.ok(container.textContent?.includes("Demo server started."));
        assert.equal(button("Stop").disabled, false);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

// A complete data-only test locale retains tokens while making every site-owned message distinguishable.
const localized = Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, `訳 ${value}`]));
const translated = createTranslator("ja", localized);

/** Mounts the real UI and exposes interactions without coupling them to English labels. */
async function mountLocalizedDemo() {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Demo dictionary={localized} locale="ja" />));
    /** Finds an action by its translated visible label. */
    const button = (key: string) => {
        const found = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === translated.t(key));
        assert.ok(found, `Missing button: ${key}`);
        return found;
    };
    /** Dispatches a normal click through React's event handlers. */
    const click = async (key: string) => { await act(async () => button(key).click()); };
    /** Updates controlled fields through the native setter so React observes the event. */
    const input = async (selector: string, value: string) => {
        const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
        const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        await act(async () => {
            Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
            field.dispatchEvent(new Event("input", { bubbles: true }));
        });
    };
    /** Unmounts effects and removes only the test-owned DOM. */
    const cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
    return { container, button, click, input, cleanup };
}

test("wireframe metadata and route deliver only the cookie-selected page namespace", async () => {
    const original = localeDefinitions.ja;
    try {
        for (const locale of [undefined, "invalid", "ja"]) {
            request.locale = locale;
            const page = await ServerWireframePage();
            assert.equal(page.props.locale, "en");
            assert.deepEqual(Object.keys(page.props.messages), ["server-wireframe"]);
            assert.equal((await generateMetadata()).title, messages["metadata.title"]);
        }
        localeDefinitions.ja = { ...original, enabled: true, dictionaries: { "server-wireframe": async () => ({ default: localized }) } };
        request.locale = "ja";
        const metadata = await generateMetadata();
        assert.equal(metadata.title, translated.t("metadata.title"));
        assert.equal(metadata.description, translated.t("metadata.description"));
        assert.deepEqual(metadata.robots, { index: false, follow: false });
        const page = await ServerWireframePage();
        assert.equal(page.props.locale, "ja");
        assert.deepEqual(Object.keys(page.props.messages), ["server-wireframe"]);
        assert.match(renderToStaticMarkup(page), /訳 Public wireframe/);
        assertDictionaryParity(messages, localized, "wireframe-test");
    } finally { localeDefinitions.ja = original; request.locale = undefined; }
});

test("localized console searches descriptions, preserves command/log payloads, and translates confirmations", async () => {
    const demo = await mountLocalizedDemo();
    const { container, click, input } = demo;
    try {
        assert.equal(container.querySelector("h1")?.textContent, "The Northern March");
        assert.equal(container.querySelector('[role="log"]')?.getAttribute("aria-label"), translated.t("console.output"));
        await click("address.show");
        assert.equal(container.querySelector("#server-address")?.textContent, "203.0.113.42:7210");
        await click("address.hide");
        await input("#command-search", "訳 Send a message");
        assert.equal(container.querySelectorAll("#command-picker li").length, 1);
        const insert = container.querySelector<HTMLButtonElement>(`button[aria-label='${translated.t("commands.insert", { command: "announce" })}']`)!;
        await act(async () => insert.click());
        assert.equal(container.querySelector<HTMLInputElement>("#console-command")?.value, 'announce "Welcome to the campaign!"');
        await click("console.send");
        assert.ok(container.querySelector('[role="log"]')?.textContent?.includes('> announce "Welcome to the campaign!"'));
        assert.ok(container.querySelector('[role="log"]')?.textContent?.includes("[DEMO] Command received locally. Nothing was sent to a server."));
        await input("#command-search", "no-such-command");
        assert.ok(container.textContent?.includes(translated.t("commands.empty")));
        await click("lifecycle.stop");
        assert.equal(container.querySelector("#lifecycle-confirmation")?.textContent, translated.t("lifecycle.stopTitle"));
        assert.ok(container.textContent?.includes(translated.t("lifecycle.stopWarning")));
        await click("lifecycle.stopAction");
        assert.ok(container.textContent?.includes(translated.t("lifecycle.stopNotice")));
        assert.ok(container.textContent?.includes(translated.t("lifecycle.stopped")));
        assert.equal(demo.button("console.send").disabled, true);
        assert.ok(container.querySelector('[role="log"]')?.textContent?.includes("[DEMO] Server stopped locally. No live server was changed."));
        await click("lifecycle.start");
        assert.ok(container.textContent?.includes(translated.t("lifecycle.startNotice")));
        await click("lifecycle.restart");
        assert.ok(container.textContent?.includes(translated.t("lifecycle.restartWarning")));
        await click("lifecycle.restartAction");
        assert.ok(container.textContent?.includes(translated.t("lifecycle.restartNotice")));
    } finally { await demo.cleanup(); }
});

test("localized backup demo translates names, formatted details, restore confirmation and feedback", async () => {
    const demo = await mountLocalizedDemo();
    const { container, click } = demo;
    try {
        await click("workspace.backups");
        assert.ok(container.textContent?.includes(translated.t("backups.beforeSession")));
        assert.ok(container.textContent?.includes(translated.number(24.8, { style: "unit", unit: "megabyte", unitDisplay: "short" })));
        await click("backups.create");
        assert.ok(container.textContent?.includes(translated.t("backups.created")));
        await click("backups.restore");
        const name = translated.t("backups.manualName");
        assert.ok(container.textContent?.includes(translated.t("backups.restoreTitle", { name })));
        await click("backups.confirm");
        assert.ok(container.textContent?.includes(translated.t("backups.restored", { name })));
        assert.equal(container.querySelectorAll("li").length, 3);
    } finally { await demo.cleanup(); }
});
