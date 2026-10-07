import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ServerWireframe from "./ServerWireframe";
import { LocalizationProvider } from "@/app/lib/localization/client";
import messages from "@/app/lib/localization/dictionaries/en/server-wireframe.json";
import managed from "@/app/lib/localization/dictionaries/en/managed-server.json";
import { createTranslator } from "@/app/lib/localization/translator";
import { assertDictionaryParity } from "@/app/lib/localization/integrity";
import { localeDefinitions } from "@/app/lib/localization/registry";
import type { Dictionary, Locale } from "@/app/lib/localization/types";

const request = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: request.locale }) }) }));
import ServerWireframePage, { generateMetadata } from "./page";

/** Supplies the same scoped dictionary boundary used by the public route. */
function Demo({ dictionary = messages, locale = "en" }: { dictionary?: Dictionary; locale?: Locale }) {
    return <LocalizationProvider locale={locale} messages={{ "server-wireframe": dictionary, "managed-server": managed }}><ServerWireframe /></LocalizationProvider>;
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
    /** Finds an English action for the default-locale lifecycle regression. */
    const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
    /** Dispatches the lifecycle action through React. */
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
    /** Supplies a selected file without depending on jsdom's missing file-picker implementation. */
    const upload = async (selector: string, file: File) => {
        const field = container.querySelector<HTMLInputElement>(selector)!;
        Object.defineProperty(field, "files", { configurable: true, value: [file] });
        await act(async () => field.dispatchEvent(new Event("change", { bubbles: true })));
    };
    /** Updates provider props as a locale refresh would, retaining the existing demo state. */
    const switchToEnglish = async () => { await act(async () => root.render(<Demo />)); };
    /** Unmounts effects and removes only the test-owned DOM. */
    const cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
    return { container, button, click, input, upload, switchToEnglish, cleanup };
}

test("wireframe metadata and route deliver only the cookie-selected page namespace", async () => {
    const original = localeDefinitions.ja;
    try {
        // ja stands in for any switched-off locale, which must fall back to English.
        localeDefinitions.ja = { ...original, enabled: false };
        for (const locale of [undefined, "invalid", "ja"]) {
            request.locale = locale;
            const page = await ServerWireframePage();
            assert.equal(page.props.locale, "en");
            assert.deepEqual(Object.keys(page.props.messages), ["server-wireframe", "managed-server"]);
            assert.equal((await generateMetadata()).title, messages["metadata.title"]);
        }
        localeDefinitions.ja = { ...original, enabled: true, dictionaries: { ...original.dictionaries, "server-wireframe": async () => ({ default: localized }) } };
        request.locale = "ja";
        const metadata = await generateMetadata();
        assert.equal(metadata.title, translated.t("metadata.title"));
        assert.equal(metadata.description, translated.t("metadata.description"));
        assert.deepEqual(metadata.robots, { index: false, follow: false });
        const page = await ServerWireframePage();
        assert.equal(page.props.locale, "ja");
        assert.deepEqual(Object.keys(page.props.messages), ["server-wireframe", "managed-server"]);
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

// Focused matrix: invalid config → error; valid draft → save/discard/export; imports → preserve bytes or report read error;
// save replacement → filename only; settings/copy → localized feedback; locale refresh → retained state with current messages.

/** Covers invalid drafts without allowing localization to change validation or discard behavior. */
test("localized config validation preserves invalid drafts and discards back to saved JSON", async () => {
    const demo = await mountLocalizedDemo();
    try {
        await demo.click("workspace.saveConfig");
        const editor = demo.container.querySelector<HTMLTextAreaElement>("#config-json")!;
        const initial = editor.value;
        await demo.input("#config-json", "[]");
        await demo.click("config.save");
        assert.equal(editor.value, "[]");
        assert.equal(editor.getAttribute("aria-invalid"), "true");
        assert.equal(demo.container.querySelector('[role="alert"]')?.textContent, translated.t("config.invalid"));
        await demo.switchToEnglish();
        assert.equal(demo.container.querySelector('[role="alert"]')?.textContent, messages["config.invalid"]);
        const discard = [...demo.container.querySelectorAll("button")].find(item => item.textContent === messages["action.discard"])!;
        await act(async () => discard.click());
        assert.equal(editor.value, initial);
        assert.equal(demo.container.querySelector('[role="alert"]'), null);
        assert.ok(demo.container.textContent?.includes(messages["draft.discarded"]));
    } finally { await demo.cleanup(); }
});

/** Covers validated import, local save and byte-preserving export with translated feedback. */
test("localized config imports, saves and exports unchanged JSON while form preview stays disabled", async () => {
    const demo = await mountLocalizedDemo();
    const payload = '{ "serverLabel": "自分の名前", "maxPlayers": 12 }';
    const file = new File([payload], "user-config.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => payload });
    const blobs: Blob[] = [];
    // Captures only local browser export URLs while retaining ordinary URL behavior.
    vi.stubGlobal("URL", class extends URL {
        /** Captures the browser download payload without creating a real download. */
        static createObjectURL(blob: Blob) { blobs.push(blob); return "blob:demo-config"; }
        /** Replaces browser URL cleanup for the captured download. */
        static revokeObjectURL() {}
    });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
        await demo.click("workspace.saveConfig");
        await demo.upload("#config-import", file);
        assert.equal(demo.container.querySelector<HTMLTextAreaElement>("#config-json")?.value, payload);
        assert.ok(demo.container.textContent?.includes(translated.t("config.imported")));
        await demo.click("config.save");
        assert.ok(demo.container.textContent?.includes(translated.t("config.saved")));
        assert.ok(demo.container.textContent?.includes(translated.t("draft.clean")));
        await demo.click("config.export");
        assert.equal((download.mock.contexts[0] as HTMLAnchorElement).download, "wireframe-config.json");
        assert.equal(blobs[0].type, "application/json");
        assert.equal(await readBlob(blobs[0]), payload);
        assert.ok(demo.container.textContent?.includes(translated.t("config.exported")));
        await demo.click("config.form");
        assert.equal(demo.container.querySelector("fieldset")?.disabled, true);
        assert.ok(demo.container.textContent?.includes(translated.t("config.formHelp")));
        assert.ok(demo.container.textContent?.includes(translated.t("config.maxPlayers")));
    } finally { download.mockRestore(); vi.unstubAllGlobals(); await demo.cleanup(); }
});

/** Reads a jsdom Blob through its supported browser API for payload assertions. */
function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

/** Covers a failed file read without replacing or saving the user's draft. */
test("localized unreadable config import reports an accessible error and retains the draft", async () => {
    const demo = await mountLocalizedDemo();
    const file = new File([], "unreadable.json");
    Object.defineProperty(file, "text", { value: async () => { throw new Error("file unavailable"); } });
    try {
        await demo.click("workspace.saveConfig");
        await demo.input("#config-json", '{"unchanged":true}');
        await demo.upload("#config-import", file);
        assert.equal(demo.container.querySelector('[role="alert"]')?.textContent, translated.t("config.readFailed"));
        assert.equal(demo.container.querySelector<HTMLTextAreaElement>("#config-json")?.value, '{"unchanged":true}');
    } finally { await demo.cleanup(); }
});

/** Covers the save confirmation with an untouched user filename and no file reads. */
test("localized save replacement changes only the displayed filename", async () => {
    const demo = await mountLocalizedDemo();
    const filename = "私の campaign.sav";
    const file = new File(["not read"], filename);
    const read = vi.fn();
    Object.defineProperty(file, "text", { value: read });
    try {
        await demo.click("workspace.saveConfig");
        await demo.click("save.export");
        assert.ok(demo.container.textContent?.includes(translated.t("save.exportNotice")));
        await demo.upload("#save-import", file);
        assert.ok(demo.container.textContent?.includes(translated.t("save.replaceTitle", { filename })));
        assert.ok(demo.container.textContent?.includes(translated.t("save.warning")));
        await demo.click("save.replace");
        assert.ok(demo.container.textContent?.includes(filename));
        assert.ok(demo.container.textContent?.includes(translated.t("save.replaced")));
        assert.equal(read.mock.calls.length, 0);
    } finally { await demo.cleanup(); }
});

/** Covers settings persistence across locale refresh without translating entered names or visibility values. */
test("localized settings preserve user names and retranslate feedback on locale refresh", async () => {
    const demo = await mountLocalizedDemo();
    try {
        await demo.click("workspace.settings");
        await demo.input("#server-name", "User's 北方 server");
        await act(async () => demo.container.querySelector<HTMLInputElement>('input[value="public"]')!.click());
        await demo.click("settings.save");
        assert.equal(demo.container.querySelector("h1")?.textContent, "User's 北方 server");
        assert.ok(demo.container.textContent?.includes(translated.t("settings.saved")));
        assert.equal(demo.container.querySelector("summary")?.getAttribute("aria-label"), translated.t("visibility.publicEdit"));
        await demo.switchToEnglish();
        assert.equal(demo.container.querySelector("h1")?.textContent, "User's 北方 server");
        assert.equal(demo.container.querySelector<HTMLInputElement>('input[value="public"]')?.checked, true);
        assert.ok(demo.container.textContent?.includes(messages["settings.saved"]));
        assert.ok(!demo.container.textContent?.includes(translated.t("settings.saved")));
    } finally { await demo.cleanup(); }
});

/** Covers interpolated backup notices so neither the message nor demo-owned name stays in the old locale. */
test("restored backup feedback follows a locale refresh without resetting backup state", async () => {
    const demo = await mountLocalizedDemo();
    try {
        await demo.click("workspace.backups");
        await demo.click("backups.create");
        await demo.click("backups.restore");
        await demo.click("backups.confirm");
        await demo.switchToEnglish();
        const english = createTranslator("en", messages);
        assert.ok(demo.container.textContent?.includes(english.t("backups.restored", { name: english.t("backups.manualName") })));
        assert.equal(demo.container.querySelectorAll("li").length, 3);
    } finally { await demo.cleanup(); }
});

/** Covers clipboard success and denial using local stubs, never a live connection. */
test.each([true, false])("localized copy feedback preserves the demo address (success=%s)", async (success) => {
    const demo = await mountLocalizedDemo();
    const writeText = vi.fn(async (_value: string) => { if (!success) throw new Error("denied"); });
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
        await demo.click("address.copy");
        assert.deepEqual(writeText.mock.calls, [["203.0.113.42:7210"]]);
        assert.ok(demo.container.textContent?.includes(translated.t(success ? "address.copied" : "address.copyFailed")));
        const dismiss = demo.container.querySelector<HTMLButtonElement>(`[aria-label="${translated.t("feedback.dismiss")}"]`)!;
        await act(async () => dismiss.click());
        assert.equal(demo.container.querySelector(`[aria-label="${translated.t("feedback.dismiss")}"]`), null);
    } finally {
        if (original) Object.defineProperty(navigator, "clipboard", original);
        else Reflect.deleteProperty(navigator, "clipboard");
        await demo.cleanup();
    }
});
