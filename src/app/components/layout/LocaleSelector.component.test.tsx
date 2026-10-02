import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { localeNavigationTarget } from "@/app/lib/localization/navigation";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import type { Locale, LocaleOption } from "@/app/lib/localization/types";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), setLocale: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("@/app/lib/localization/actions", () => ({ setLocale: mocks.setLocale }));
vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));
import { LocaleSelector } from "./LocaleSelector";
import { MobileNavigation } from "./MobileNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.resetAllMocks(); window.history.replaceState(null, "", "/"); });

const twoLocales: LocaleOption[] = [{ locale: "en", name: "English" }, { locale: "ru", name: "Русский" }];

/** Provides two enabled fixture locales without enabling unfinished production dictionaries. */
function Selectors({ locale = "en" }: { locale?: Locale }) {
    return <LocalizationProvider locale={locale} messages={{ common }} enabledLocales={twoLocales}>
        <LocaleSelector variant="desktop" />
        <MobileNavigation isAdmin={false} isAuthenticated={false} />
    </LocalizationProvider>;
}

/** Renders one desktop selector with the given enabled options. */
function DesktopSelector({ options = twoLocales }: { options?: LocaleOption[] }) {
    return <LocalizationProvider locale="en" messages={{ common }} enabledLocales={options}><LocaleSelector variant="desktop" /></LocalizationProvider>;
}

/** Finds the trigger button of each rendered selector. */
function triggers(container: Element) {
    return [...container.querySelectorAll<HTMLButtonElement>("[data-locale-selector] > button")];
}

/** Opens a selector and chooses the option for the given locale. */
async function choose(trigger: HTMLButtonElement, locale: Locale) {
    await act(async () => trigger.click());
    const options = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    await act(async () => options.querySelector<HTMLButtonElement>(`button[lang="${locale}"]`)!.click());
}

it("preserves authentication queries, filters, and anchors and clears stale Chinese cheats overrides", () => {
    expect(localeNavigationTarget("https://bannerlordcoop.com/login?next=%2Faccount&code=abc#form", "ru")).toBe("/login?next=%2Faccount&code=abc#form");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?lang=chinese&search=gold&category=party#command", "en")).toBe("/cheats?search=gold&category=party#command");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?lang=zh-CN&search=gold#command", "ru")).toBe("/cheats?search=gold&lang=ru#command");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?search=gold#command", "en")).toBe("/cheats?search=gold#command");
    expect(localeNavigationTarget("https://bannerlordcoop.com/cheats?lang=zh&lang=cn#command", "en")).toBe("/cheats#command");
});

it("offers named flagged desktop/mobile lists, persists selection, and agrees after navigation/reload", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ addEventListener: vi.fn(), removeEventListener: vi.fn(), matches: false });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mocks.setLocale.mockResolvedValue("ru");
    window.history.replaceState(null, "", "/cheats?lang=zh-CN&search=gold#command");
    try {
        await act(async () => root.render(<Selectors />));
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-controls="mobile-navigation"]')!.click());
        const [desktop, mobile] = triggers(container);
        expect(desktop.getAttribute("aria-controls")).not.toBe(mobile.getAttribute("aria-controls"));
        for (const trigger of [desktop, mobile]) {
            const [label, value] = trigger.getAttribute("aria-labelledby")!.split(" ").map((id) => document.getElementById(id)!.textContent);
            expect([label, value]).toEqual(["Language", "English"]);
            await act(async () => trigger.click());
            expect(trigger.getAttribute("aria-expanded")).toBe("true");
            const options = [...document.getElementById(trigger.getAttribute("aria-controls")!)!.querySelectorAll("button")];
            expect(options.map((option) => option.lang)).toEqual(["en", "ru"]);
            expect(options.every((option) => option.querySelector("svg"))).toBe(true);
            expect(options[0].getAttribute("aria-current")).toBe("true");
            await act(async () => trigger.click());
        }
        await choose(mobile, "ru");
        expect(mobile.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(mobile);
        expect(mocks.setLocale).toHaveBeenCalledWith("ru");
        expect(mocks.replace).toHaveBeenCalledWith("/cheats?search=gold&lang=ru#command", { scroll: false });
        expect(mocks.refresh).toHaveBeenCalledOnce();
        await act(async () => root.render(<Selectors locale="ru" />));
        expect(triggers(container).map((trigger) => trigger.textContent)).toEqual(["Русский", "Русский"]);
        mocks.setLocale.mockResolvedValue("en");
        await choose(desktop, "en");
        expect(mocks.replace).toHaveBeenLastCalledWith("/cheats?search=gold#command", { scroll: false });
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

it("closes the list on Escape without closing the mobile drawer", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ addEventListener: vi.fn(), removeEventListener: vi.fn(), matches: false });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<Selectors />));
        const menuButton = container.querySelector<HTMLButtonElement>('button[aria-controls="mobile-navigation"]')!;
        await act(async () => menuButton.click());
        const mobile = triggers(container)[1];
        await act(async () => mobile.click());
        const option = document.getElementById(mobile.getAttribute("aria-controls")!)!.querySelector<HTMLButtonElement>('button[lang="ru"]')!;
        option.focus();
        await act(async () => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(mobile.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(mobile);
        expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

it("can explicitly reapply English to a Chinese cheats link even when English is the only enabled option", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    window.history.replaceState(null, "", "/cheats?lang=zh-CN&search=gold#command");
    mocks.setLocale.mockResolvedValue("en");
    try {
        await act(async () => root.render(<DesktopSelector options={[{ locale: "en", name: "English" }]} />));
        await choose(triggers(container)[0], "en");
        expect(mocks.setLocale).toHaveBeenCalledWith("en");
        expect(mocks.replace).toHaveBeenCalledWith("/cheats?search=gold#command", { scroll: false });
    } finally { await act(async () => root.unmount()); container.remove(); }
});

it("refreshes the same route without dropping query/hash and reports persistence failures accessibly", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    window.history.replaceState(null, "", "/account?next=%2Fservers#details");
    mocks.setLocale.mockResolvedValue("ru");
    try {
        await act(async () => root.render(<DesktopSelector />));
        const trigger = triggers(container)[0];
        await choose(trigger, "ru");
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(mocks.refresh).toHaveBeenCalledOnce();
        expect(window.location.search + window.location.hash).toBe("?next=%2Fservers#details");
        mocks.setLocale.mockRejectedValue(new Error("unavailable"));
        await choose(trigger, "ru");
        const alert = container.querySelector('[role="alert"]')!;
        expect(alert.textContent).toBe(common["locale.error"]);
        expect(trigger.getAttribute("aria-describedby")).toBe(alert.id);
        expect(trigger.textContent).toBe("English");
    } finally { await act(async () => root.unmount()); container.remove(); }
});
