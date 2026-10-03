import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTranslator } from "./translator";
import { LocalizationProvider, useLocalization, useTranslations } from "./client";
import { assertDictionaryParity } from "./integrity";
import { localeDefinitions, getEnabledLocales, resolveLocale } from "./registry";
import { locales, namespaces, localeCookie, localeCookieOptions, type Dictionary } from "./types";
import common from "./dictionaries/en/common.json";

const request = vi.hoisted(() => ({ value: undefined as string | undefined, set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "blcoop-locale" ? { value: request.value } : undefined, set: request.set }) }));
vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "inter" }), Barlow_Condensed: () => ({ variable: "barlow" }), Cormorant_Garamond: () => ({ variable: "cormorant" }) }));
vi.mock("@/app/components/admin/ImpersonationBanner", () => ({ ImpersonationBanner: () => null }));
import { getLocale, getMessages, getTranslations } from "./server";
import { setLocale } from "./actions";
import RootLayout, { generateMetadata } from "@/app/layout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { request.value = undefined; request.set.mockReset(); });

/** Exercises the same namespace hook on the server-rendered and hydrated client tree. */
function CommonProbe() {
    const { t, locale } = useTranslations("common");
    return <p lang={locale}>{t("loading.page")}</p>;
}

/** Exposes nested namespace and root locale resolution independently. */
function ScopedProbe() {
    const common = useTranslations("common");
    const cheats = useTranslations("cheats");
    const root = useLocalization();
    return <p>{root.locale}|{common.locale}|{cheats.locale}|{cheats.t("heading")}</p>;
}

describe("localization runtime", () => {
    it("defaults absent, invalid, and disabled cookies to English without browser detection", async () => {
        expect(getEnabledLocales()).toEqual(Object.values(localeDefinitions).filter((entry) => entry.enabled).map(({ locale, name }) => ({ locale, name })));
        const disabled = locales.filter((locale) => !localeDefinitions[locale].enabled);
        for (const value of [undefined, "invalid", "__proto__", "en", ...disabled]) {
            request.value = value;
            expect(resolveLocale(value)).toBe("en");
            expect(await getLocale()).toBe("en");
            expect((await getTranslations("common")).locale).toBe("en");
            const layout = await RootLayout({ children: <span />, params: Promise.resolve({}) });
            expect(layout.props.lang).toBe("en");
            expect(layout.props.children.props.children.props.locale).toBe("en");
            expect((await generateMetadata()).openGraph).toMatchObject({ locale: "en_US", description: common["metadata.description"] });
        }
    });

    it("persists a validated preference with the shared cookie contract", async () => {
        request.set.mockImplementation((_name, value) => { request.value = value; });
        expect(await setLocale("en")).toBe("en");
        expect(request.set).toHaveBeenCalledWith(localeCookie, "en", localeCookieOptions);
        expect(await getLocale()).toBe("en");
        const disabled = locales.find((locale) => !localeDefinitions[locale].enabled);
        if (disabled) expect(await setLocale(disabled)).toBe("en");
        expect(await setLocale("bogus")).toBe("en");
    });

    it("uses activated data for cookie, metadata, and root delivery without runtime edits", async () => {
        const original = localeDefinitions.ru;
        localeDefinitions.ru = { ...original, enabled: true, dictionaries: { common: async () => ({ default: { ...common, "metadata.description": "Описание", "loading.page": "Загрузка…" } }) } };
        try {
            request.set.mockImplementation((_name, value) => { request.value = value; });
            expect(await setLocale("ru")).toBe("ru");
            expect(await getLocale()).toBe("ru");
            expect((await getTranslations("common")).t("loading.page")).toBe("Загрузка…");
            const layout = await RootLayout({ children: <span />, params: Promise.resolve({}) });
            expect(layout.props.lang).toBe("ru");
            expect(layout.props.children.props.children.props.locale).toBe("ru");
            expect((await generateMetadata()).openGraph).toMatchObject({ locale: "ru_RU", description: "Описание" });
        } finally { localeDefinitions.ru = original; }
    });

    it("loads only requested namespaces and root serializes common only", async () => {
        const spy = vi.spyOn(localeDefinitions.en.dictionaries as Required<typeof localeDefinitions.en.dictionaries>, "cheats");
        try {
            expect(Object.keys(await getMessages(["common"]))).toEqual(["common"]);
            const layout = await RootLayout({ children: <span />, params: Promise.resolve({}) });
            expect(Object.keys(layout.props.children.props.children.props.messages)).toEqual(["common"]);
            expect(spy).not.toHaveBeenCalled();
            const disabled = locales.find((locale) => !localeDefinitions[locale].enabled);
            if (disabled) await expect(getMessages(["common"], disabled)).rejects.toThrow("not enabled");
        } finally { spy.mockRestore(); }
    });

    it("agrees between SSR and hydration and composes scoped content without changing chrome", async () => {
        const tree = <LocalizationProvider locale="en" messages={{ common }}><CommonProbe /></LocalizationProvider>;
        const container = document.createElement("div");
        container.innerHTML = renderToStaticMarkup(tree);
        const before = container.innerHTML;
        const recover = vi.fn();
        const root = hydrateRoot(container, tree, { onRecoverableError: recover });
        await act(async () => {});
        expect(container.innerHTML).toBe(before);
        expect(recover).not.toHaveBeenCalled();
        await act(async () => root.unmount());
        expect(renderToStaticMarkup(
            <LocalizationProvider locale="en" messages={{ common }}>
                <LocalizationProvider locale="zh-CN" messages={{ cheats: { heading: "命令" } }}><ScopedProbe /></LocalizationProvider>
            </LocalizationProvider>,
        )).toContain("en|en|zh-CN|命令");
    });

    it("selects plurals via count and formats dates/numbers deterministically", () => {
        const t = createTranslator("ru", { count: { one: "one {count}", few: "few {count}", many: "many {count}", other: "other {count}" } });
        expect(t.t("count", { count: 1 })).toBe("one 1");
        expect(t.t("count", { count: 2 })).toBe("few 2");
        expect(t.t("count", { count: 5 })).toBe("many 5");
        expect(t.t("count", { count: 1.5 })).toBe("other 1.5");
        expect(() => t.t("count")).toThrow("numeric count");
        expect(t.number(1234.5)).toBe(new Intl.NumberFormat("ru").format(1234.5));
        expect(t.date("2026-09-30T23:00:00Z", { dateStyle: "long" })).toBe(new Intl.DateTimeFormat("ru", { dateStyle: "long", timeZone: "UTC" }).format(new Date("2026-09-30T23:00:00Z")));
    });

    it("interpolates once, reorders rich slots, and never parses HTML", () => {
        const t = createTranslator("en", { rich: "{second}, then {first}.", text: "Hello {name}" });
        expect(t.t("text", { name: "{second}" })).toBe("Hello {second}");
        expect(renderToStaticMarkup(<div>{t.rich("rich", { first: "<script>bad</script>", second: <strong>Safe</strong> })}</div>)).toBe("<div><strong>Safe</strong>, then &lt;script&gt;bad&lt;/script&gt;.</div>");
        expect(() => t.t("missing")).toThrow("Missing translation");
        expect(() => t.rich("rich", { first: "only" })).toThrow("Missing translation token");
    });

    it("keeps client runtime imports separate from cookies, loaders, and dictionary payloads", () => {
        for (const file of ["client.tsx", "translator.tsx", "types.ts", "navigation.ts"]) {
            const source = readFileSync(resolve("src/app/lib/localization", file), "utf8");
            expect(source).not.toMatch(/from ["'].*(?:server|registry|locales\/|dictionaries\/|next\/headers)/);
        }
        for (const locale of locales) {
            expect(readFileSync(resolve("src/app/lib/localization/locales", `${locale}.ts`), "utf8")).toContain('import "server-only"');
        }
    });
});

describe("enabled dictionary integrity", () => {
    it("requires exact namespaces, keys, and tokens for every activated locale", async () => {
        const english = await getMessages(namespaces, "en");
        for (const definition of Object.values(localeDefinitions).filter((entry) => entry.enabled)) {
            expect(Object.keys(definition.dictionaries).sort()).toEqual([...namespaces].sort());
            const translated = await getMessages(namespaces, definition.locale);
            for (const namespace of namespaces) assertDictionaryParity(english[namespace]!, translated[namespace]!, `${definition.locale}.${namespace}`);
        }
    });

    it("fails missing/extra keys, changed tokens, invalid kinds, and incomplete plural forms", () => {
        const english: Dictionary = { count: { one: "{count} result for {name}", other: "{count} results for {name}" } };
        for (const invalid of [
            {}, { ...english, extra: "extra" }, { count: "{count} {name}" },
            { count: { other: "{count} {renamed}" } },
            { count: { one: "{count} {name}" } },
            { count: { one: "{name}", other: "{count} {name}" } },
            { count: { invalid: "{count} {name}", other: "{count} {name}" } },
        ]) expect(() => assertDictionaryParity(english, invalid as Dictionary, "test")).toThrow();
        expect(() => assertDictionaryParity(english, { count: { few: "{name}: {count}", many: "{count} {name}", other: "{name} {count}" } }, "ru")).not.toThrow();
    });
});
