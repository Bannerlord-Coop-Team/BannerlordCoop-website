import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { LocalizationProvider, useTranslations } from "../lib/localization/client";
import { localeDefinitions } from "../lib/localization/registry";
import { getLocale } from "../lib/localization/server";
import common from "../lib/localization/dictionaries/en/common.json";
import english from "../lib/localization/dictionaries/en/cheats.json";
import chinese from "./locales/zh-CN.json";
import commandsData from "./commands.json";
import type { Locale } from "../lib/localization/types";
import { LocaleSelector } from "../components/layout/LocaleSelector";
import { getCheatsLocalization } from "./localization";
import CheatsPage, { generateMetadata } from "./page";

const request = vi.hoisted(() => ({ cookie: undefined as string | undefined, legacyCookie: "zh-CN", set: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
    get: (name: string) => ({ value: name === "blcoop-locale" ? request.cookie : request.legacyCookie }),
    set: request.set,
}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: request.replace, refresh: request.refresh }) }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const initialRu = localeDefinitions.ru;
const initialZh = localeDefinitions["zh-CN"];
beforeEach(() => {
    localeDefinitions.ru = { ...initialRu, enabled: false };
    localeDefinitions["zh-CN"] = { ...initialZh, enabled: false };
});
afterEach(() => {
    request.cookie = undefined;
    localeDefinitions.ru = initialRu;
    localeDefinitions["zh-CN"] = initialZh;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
});

/** Reads common chrome independently of the nested cheats content provider. */
function ChromeProbe() {
    const { locale, t } = useTranslations("common");
    return <aside data-chrome-lang={locale}>{t("nav.cheats")}</aside>;
}

/** Composes the actual server page with the root cookie locale and optional shared selector. */
async function pageTree(params: Record<string, string> = {}, selector = false) {
    const locale = await getLocale();
    return <LocalizationProvider locale={locale} messages={{ common }} enabledLocales={[{ locale: "en", name: "English" }]}>
        <ChromeProbe />
        {selector && <LocaleSelector variant="desktop" />}
        {await CheatsPage({ searchParams: Promise.resolve(params) })}
    </LocalizationProvider>;
}

it("keeps all legacy Chinese aliases as content and metadata overrides while Chinese is globally disabled", async () => {
    expect(localeDefinitions["zh-CN"].enabled).toBe(false);
    for (const lang of ["zh", "zh-CN", "zh_hans", "zh-hans-cn", "cn"]) {
        const binding = await getCheatsLocalization(lang);
        expect(binding.locale).toBe("zh-CN");
        expect(Object.keys(binding.messages)).toEqual(["cheats"]);
        expect(binding.translator.t("ui.title")).toBe(chinese["ui.title"]);
        const metadata = await generateMetadata({ searchParams: Promise.resolve({ lang }) });
        expect(metadata.title).toBe(chinese["ui.metadataTitle"]);
        expect(metadata.description).toBe(chinese["ui.metadataDescription"]);
        expect(metadata.openGraph).toMatchObject({ locale: "zh_CN", url: "/cheats?lang=zh-CN" });
    }
});

it("ignores the retired cheats cookie, disabled/invalid global choices, and invalid overrides", async () => {
    for (const cookie of [undefined, "invalid", "zh-CN", "en"]) {
        request.cookie = cookie;
        for (const lang of [undefined, "invalid", "ru"]) {
            expect((await getCheatsLocalization(lang)).locale).toBe("en");
        }
        expect((await generateMetadata({ searchParams: Promise.resolve({}) })).title).toBe("Cheats");
    }
    expect(request.set).not.toHaveBeenCalled();
});

/** Exercises test-only locale activation for cookie content, explicit overrides, and metadata. */
it("uses activated dictionaries for cookie and explicit links with no page-code changes", async () => {
    localeDefinitions.ru = { ...initialRu, enabled: true, dictionaries: { cheats: async () => ({ default: { ...english, "ui.title": "Команды", "ui.metadataTitle": "Команды" } }) } };
    request.cookie = "ru";
    expect((await getCheatsLocalization(undefined)).translator.t("ui.title")).toBe("Команды");
    const rendered = renderToStaticMarkup(await pageTree());
    expect(rendered).toContain('lang="ru"');
    expect(rendered).toContain("Команды");
    expect((await getCheatsLocalization("en")).locale).toBe("en");
    expect((await getCheatsLocalization("cn")).locale).toBe("zh-CN");
    request.cookie = "en";
    expect((await getCheatsLocalization("ru")).translator.t("ui.title")).toBe("Команды");
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ lang: "ru" }) });
    expect(metadata.openGraph).toMatchObject({ locale: "ru_RU", title: "Команды" });
    expect(metadata.alternates?.languages).toMatchObject({ en: "/cheats?lang=en", "zh-CN": "/cheats?lang=zh-CN", ru: "/cheats?lang=ru" });
    localeDefinitions["zh-CN"] = { ...initialZh, enabled: true, dictionaries: { cheats: async () => ({ default: { ...chinese, "ui.title": "Activated Chinese" } }) } };
    expect((await getCheatsLocalization("cn")).translator.t("ui.title")).toBe("Activated Chinese");
});

/** Copied English command/search links must override the recipient's non-English cookie. */
it.each(["command", "search"] as const)("keeps copied English %s links English under a Russian cookie", async (kind) => {
    localeDefinitions.ru = { ...initialRu, enabled: true, dictionaries: { cheats: async () => ({ default: english }) } };
    request.cookie = "ru";
    expect((await getCheatsLocalization(undefined)).locale).toBe("ru");
    const params = { lang: "en", q: "gold", tab: "all", type: "gameplay", side: "server" };
    window.history.replaceState(null, "", `/cheats?${new URLSearchParams(params)}`);
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(await pageTree(params)));
        expect(container.querySelector("main")?.lang).toBe("en");
        expect(container.querySelector("[data-chrome-lang]")?.getAttribute("data-chrome-lang")).toBe("ru");
        const scope = kind === "command" ? container.querySelector('[id="cheat-coop.debug.hero.set_gold"]')! : container;
        const label = kind === "command" ? "Copy link" : "Copy search link";
        const copy = [...scope.querySelectorAll("button")].find(button => button.textContent === label)!;
        await act(async () => copy.click());
        const shared = new URL(clipboard.mock.calls[0][0]);
        expect(Object.fromEntries(shared.searchParams)).toEqual(kind === "command"
            ? { cheat: "coop.debug.hero.set_gold", lang: "en" }
            : params);
        expect((await getCheatsLocalization(shared.searchParams.get("lang") ?? undefined)).locale).toBe("en");
        expect(request.cookie).toBe("ru");
    } finally { await act(async () => root.unmount()); }
});

/** English metadata destinations must resolve English without relying on the global cookie. */
it("makes English canonical and alternate metadata explicit under a Russian cookie", async () => {
    localeDefinitions.ru = { ...initialRu, enabled: true, dictionaries: { cheats: async () => ({ default: english }) } };
    request.cookie = "ru";
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ lang: "en" }) });
    expect(metadata.title).toBe(english["ui.metadataTitle"]);
    expect(metadata.openGraph).toMatchObject({ locale: "en_US", url: "/cheats?lang=en" });
    expect(metadata.alternates?.canonical).toBe("/cheats?lang=en");
    expect(metadata.alternates?.languages?.en).toBe("/cheats?lang=en");
    for (const path of [metadata.alternates?.canonical, metadata.alternates?.languages?.en]) {
        const url = new URL(path as string, "https://example.com");
        expect((await getCheatsLocalization(url.searchParams.get("lang") ?? undefined)).locale).toBe("en");
    }
});

it("scopes Chinese content while chrome follows the cookie and hydrates without preference writes", async () => {
    window.history.replaceState(null, "", "/cheats?lang=cn&cheat=coop.debug.hero.id");
    window.localStorage.setItem("bannerlordcoop.cheats.lang", "en");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const cookieWrite = vi.spyOn(document, "cookie", "set");
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
    const tree = await pageTree({ lang: "cn", cheat: "coop.debug.hero.id" });
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToStaticMarkup(tree);
    expect(container.querySelector("main")?.lang).toBe("zh-CN");
    expect(container.querySelector("[data-chrome-lang]")?.getAttribute("data-chrome-lang")).toBe("en");
    expect(container.querySelector("h1")?.textContent).toBe("作弊指令");
    expect(container.querySelector("select")).toBeNull();
    const recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: recover }); });
    try {
        expect(recover).not.toHaveBeenCalled();
        expect(storageWrite).not.toHaveBeenCalled();
        expect(cookieWrite).not.toHaveBeenCalled();
        expect(window.location.search).toContain("lang=cn");
    } finally { await act(async () => root!.unmount()); container.remove(); }
});

it("preserves English search compatibility, translated argument search, and immutable copied syntax", async () => {
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        for (const q of ["exact hero display name", "包含多个词的值需加双引号"]) {
            window.history.replaceState(null, "", `/cheats?lang=zh-CN&tab=all&q=${encodeURIComponent(q)}`);
            const tree = await pageTree({ lang: "zh-CN", tab: "all", q });
            await act(async () => root.render(<div key={q}>{tree}</div>));
            const command = container.querySelector('[id="cheat-coop.debug.hero.set_gold"]')!;
            expect(command).not.toBeNull();
            const copy = [...command.querySelectorAll("button")].find(button => button.textContent === "复制")!;
            await act(async () => copy.click());
            expect(clipboard).toHaveBeenLastCalledWith("coop.debug.hero.set_gold <hero_name> <gold>");
        }
    } finally { await act(async () => root.unmount()); }
});

it("shared selector clears the override without directory URL writes restoring it or losing filters/hash", async () => {
    window.history.replaceState(null, "", "/cheats?lang=zh-CN&q=gold&tab=all&type=gameplay&side=server&other=keep#target");
    request.set.mockImplementation((_name: string, value: Locale) => { request.cookie = value; });
    request.replace.mockImplementation((path: string) => window.history.replaceState(null, "", path));
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(await pageTree(Object.fromEntries(new URLSearchParams(window.location.search)), true)));
        const trigger = container.querySelector("[data-locale-selector] > button") as HTMLButtonElement;
        await act(async () => trigger.click());
        await act(async () => container.querySelector<HTMLButtonElement>('[data-locale-selector] li button[lang="en"]')!.click());
        expect(request.set).toHaveBeenCalledWith("blcoop-locale", "en", { path: "/", sameSite: "lax", maxAge: 31536000 });
        expect(request.refresh).toHaveBeenCalledOnce();
        expect(new URLSearchParams(window.location.search).has("lang")).toBe(false);
        await act(async () => root.render(await pageTree(Object.fromEntries(new URLSearchParams(window.location.search)), true)));
        expect(container.querySelector("main")?.lang).toBe("en");
        expect(container.querySelector<HTMLInputElement>("#cheat-search")?.value).toBe("gold");
        const clear = container.querySelector<HTMLButtonElement>('[aria-label="Clear cheat search"]')!;
        await act(async () => clear.click());
        const query = new URLSearchParams(window.location.search);
        expect(query.has("lang")).toBe(false);
        expect(query.get("tab")).toBe("all");
        expect(query.get("type")).toBe("gameplay");
        expect(query.get("side")).toBe("server");
        expect(query.get("other")).toBe("keep");
        expect(window.location.hash).toBe("#target");
    } finally { await act(async () => root.unmount()); }
});

it("preserves command history and treats unknown category filters as escaped user content", async () => {
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    window.history.replaceState(null, "", "/cheats?lang=cn&other=keep#target");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(await pageTree({ lang: "cn" })));
        const link = container.querySelector<HTMLAnchorElement>('a[href*="cheat=coop.debug.hero.set_gold"]')!;
        await act(async () => link.click());
        expect(new URLSearchParams(window.location.search).get("cheat")).toBe("coop.debug.hero.set_gold");
        expect(window.location.hash).toBe("#target");
        await act(async () => {
            window.history.replaceState(null, "", "/cheats?lang=cn&q=absent&tab=%3Ccustom%3E&other=keep#target");
            window.dispatchEvent(new PopStateEvent("popstate"));
        });
        expect(container.querySelector<HTMLInputElement>("#cheat-search")?.value).toBe("absent");
        expect(container.textContent).toContain("<custom>");
        expect(container.querySelector("custom")).toBeNull();
        expect(container.textContent).toContain(chinese["ui.empty"]);
        expect(window.location.search).toContain("lang=cn");
    } finally { await act(async () => root.unmount()); container.remove(); }
});

it("keeps documentation code examples tied to published immutable commands in both locales", async () => {
    for (const lang of ["en", "zh-CN"]) {
        const container = document.createElement("div");
        container.innerHTML = renderToStaticMarkup(await pageTree({ lang }));
        const examples = [...container.querySelectorAll("code")].map((code) => code.textContent ?? "").filter((text) => text.startsWith("coop."));
        expect(examples).toHaveLength(4);
        for (const example of examples) expect(commandsData.commands.some((command) => command.command === example.split(" ")[0])).toBe(true);
        expect(container.textContent).toContain("Documents\\Mount and Blade II Bannerlord\\CoopData");
        expect(container.textContent).toContain("config.cheat_mode 1");
    }
});

it("keeps dictionaries and server-only loaders outside client modules and removes old preference APIs", () => {
    for (const file of ["CheatsView.tsx", "CheatsDirectory.tsx"]) {
        const source = readFileSync(`src/app/cheats/${file}`, "utf8");
        expect(source).not.toMatch(/localStorage|document\.cookie|getCheatsMessages|CheatsLocaleSwitcher|from ["'].*(?:localization\/server|\/registry|\/dictionaries|\/locales)/);
    }
});
