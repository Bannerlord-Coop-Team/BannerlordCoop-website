import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { localeNavigationTarget } from "@/app/lib/localization/navigation";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import type { Locale } from "@/app/lib/localization/types";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), setLocale: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("@/app/lib/localization/actions", () => ({ setLocale: mocks.setLocale }));
vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));
import { LocaleSelector } from "./LocaleSelector";
import { MobileNavigation } from "./MobileNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.resetAllMocks(); window.history.replaceState(null, "", "/"); });

/** Provides two enabled fixture locales without enabling unfinished production dictionaries. */
function Selectors({ locale = "en" }: { locale?: Locale }) {
    return <LocalizationProvider locale={locale} messages={{ common }} enabledLocales={[{ locale: "en", name: "English" }, { locale: "ru", name: "Русский" }]}>
        <LocaleSelector variant="desktop" />
        <MobileNavigation isAdmin={false} isAuthenticated={false} />
    </LocalizationProvider>;
}

it("preserves authentication queries, filters, and anchors and clears stale Chinese cheats overrides", () => {
    expect(localeNavigationTarget("https://bannerlordcoop.com/login?next=%2Faccount&code=abc#form", "ru")).toBe("/login?next=%2Faccount&code=abc#form");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?lang=chinese&search=gold&category=party#command", "en")).toBe("/cheats?search=gold&category=party#command");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?lang=zh-CN&search=gold#command", "ru")).toBe("/cheats?search=gold&lang=ru#command");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?search=gold#command", "en")).toBe("/cheats?search=gold#command");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?lang=zh&lang=cn#command", "en")).toBe("/cheats#command");
});

it("offers named native desktop/mobile selects, persists selection, and agrees after navigation/reload", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ addEventListener: vi.fn(), removeEventListener: vi.fn(), matches: false });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mocks.setLocale.mockResolvedValue("ru");
    window.history.replaceState(null, "", "/cheats?lang=zh-CN&search=gold#command");
    try {
        await act(async () => root.render(<Selectors />));
        const menuButton = container.querySelector<HTMLButtonElement>('button[aria-controls="mobile-navigation"]')!;
        menuButton.focus();
        await act(async () => menuButton.click());
        const selects = container.querySelectorAll("select");
        expect(selects).toHaveLength(2);
        expect(selects[0].id).not.toBe(selects[1].id);
        for (const select of selects) {
            expect(container.querySelector(`label[for="${select.id}"]`)?.textContent).toBe("Language");
            expect([...select.options].map((option) => option.value)).toEqual(["en", "ru"]);
            select.focus();
            expect(document.activeElement).toBe(select);
        }
        // Native selects supply keyboard semantics; a change event models the browser's committed choice.
        await act(async () => {
            selects[1].value = "ru";
            selects[1].dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(mocks.setLocale).toHaveBeenCalledWith("ru");
        expect(mocks.replace).toHaveBeenCalledWith("/cheats?search=gold&lang=ru#command", { scroll: false });
        expect(mocks.refresh).toHaveBeenCalledOnce();
        await act(async () => root.render(<Selectors locale="ru" />));
        expect([...container.querySelectorAll("select")].map((select) => select.value)).toEqual(["ru", "ru"]);
        await act(async () => {
            selects[0].value = "en";
            mocks.setLocale.mockResolvedValue("en");
            selects[0].dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(mocks.replace).toHaveBeenLastCalledWith("/cheats?search=gold#command", { scroll: false });
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

it("can explicitly reapply English to a Chinese cheats link even when English is the only enabled option", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    window.history.replaceState(null, "", "/cheats?lang=zh-CN&search=gold#command");
    mocks.setLocale.mockResolvedValue("en");
    try {
        await act(async () => root.render(<LocalizationProvider locale="en" messages={{ common }} enabledLocales={[{ locale: "en", name: "English" }]}><LocaleSelector variant="desktop" /></LocalizationProvider>));
        expect(container.querySelector("select")?.value).toBe("en");
        const apply = container.querySelector("button")!;
        expect(apply.textContent).toBe(common["locale.apply"]);
        await act(async () => apply.click());
        expect(mocks.setLocale).toHaveBeenCalledWith("en");
        expect(mocks.replace).toHaveBeenCalledWith("/cheats?search=gold#command", { scroll: false });
    } finally { await act(async () => root.unmount()); }
});

it("refreshes the same route without dropping query/hash and reports persistence failures accessibly", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    window.history.replaceState(null, "", "/account?next=%2Fservers#details");
    mocks.setLocale.mockResolvedValue("ru");
    try {
        await act(async () => root.render(<LocalizationProvider locale="en" messages={{ common }} enabledLocales={[{ locale: "en", name: "English" }, { locale: "ru", name: "Русский" }]}><LocaleSelector variant="desktop" /></LocalizationProvider>));
        const select = container.querySelector("select")!;
        await act(async () => { select.value = "ru"; select.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(mocks.refresh).toHaveBeenCalledOnce();
        expect(window.location.search + window.location.hash).toBe("?next=%2Fservers#details");
        mocks.setLocale.mockRejectedValue(new Error("unavailable"));
        await act(async () => { select.value = "ru"; select.dispatchEvent(new Event("change", { bubbles: true })); });
        const alert = container.querySelector('[role="alert"]')!;
        expect(alert.textContent).toBe(common["locale.error"]);
        expect(select.getAttribute("aria-describedby")).toBe(alert.id);
        expect(select.disabled).toBe(false);
        expect(select.value).toBe("en");
    } finally { await act(async () => root.unmount()); }
});
