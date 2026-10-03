import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationProvider, useTranslations } from "@/app/lib/localization/client";
import { localeDefinitions } from "@/app/lib/localization/registry";
import support from "@/app/lib/localization/dictionaries/en/support.json";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import SupportPage, { generateMetadata } from "./page";

const request = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: request.value }) }) }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));

afterEach(() => { request.value = undefined; });

/** Verifies that page delivery composes with the root common namespace for client consumers. */
function NamespaceProbe() {
    const page = useTranslations("support");
    const shared = useTranslations("common");
    return <p>{page.t("hero.heading")}|{shared.t("loading.page")}</p>;
}

describe("support page localization", () => {
    it.each([undefined, "invalid", ...Object.values(localeDefinitions).filter((entry) => !entry.enabled).map((entry) => entry.locale)])("keeps English page, provider, and metadata aligned for cookie %s", async (value) => {
        request.value = value;
        const page = await SupportPage();
        expect(page.props.locale).toBe("en");
        expect(Object.keys(page.props.messages)).toEqual(["support"]);
        const container = document.createElement("div");
        container.innerHTML = renderToStaticMarkup(page);
        for (const [key, message] of Object.entries(support)) {
            if (!key.startsWith("metadata.")) expect(container.textContent).toContain(message);
        }
        expect(await generateMetadata()).toEqual({
            title: "Support The Project",
            description: "Support the volunteer team behind Bannerlord Coop through Patreon, Buy Me a Coffee, PayPal, Afdian, or Boosty.",
        });
        expect(container.querySelectorAll(".sr-only")).toHaveLength(5);
        for (const section of container.querySelectorAll("section")) {
            expect(container.querySelector(`#${section.getAttribute("aria-labelledby")}`)).not.toBeNull();
        }
    });

    it("preserves contribution brands, destinations, and safe new-tab behavior", async () => {
        const container = document.createElement("div");
        container.innerHTML = renderToStaticMarkup(await SupportPage());
        const links = [...container.querySelectorAll("a")];
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
            "https://www.patreon.com/c/bannerlordcoop",
            "https://buymeacoffee.com/bannerlordcoop",
            "https://www.paypal.com/donate/?hosted_button_id=KHBSK4FXQ9GKS",
            "https://ifdian.net/a/BannerlordCoop",
            "https://boosty.to/bannerlordcoop/donate",
        ]);
        expect(links.map((link) => link.querySelector("span span")?.textContent?.trim())).toEqual([
            "Patreon", "Buy Me a Coffee", "PayPal", "Afdian (爱发电)", "Boosty",
        ]);
        for (const link of links) {
            expect(link.target).toBe("_blank");
            expect(link.rel).toBe("noopener noreferrer");
            expect(link.querySelector(".sr-only")?.textContent).toBe("(opens in a new tab)");
        }
    });

    it("renders every owned message and metadata from activated data without locale-specific page code", async () => {
        const original = localeDefinitions.ru;
        const translated = Object.fromEntries(Object.keys(support).map((key) => [key, `Локализация: ${key}`]));
        localeDefinitions.ru = { ...original, enabled: true, dictionaries: { support: async () => ({ default: translated }) } };
        try {
            request.value = "ru";
            const page = await SupportPage();
            expect(page.props.locale).toBe("ru");
            expect(page.props.messages).toEqual({ support: translated });
            const container = document.createElement("div");
            container.innerHTML = renderToStaticMarkup(page);
            for (const [key, message] of Object.entries(translated)) {
                if (!key.startsWith("metadata.")) expect(container.textContent).toContain(message);
            }
            expect(await generateMetadata()).toEqual({
                title: translated["metadata.title"], description: translated["metadata.description"],
            });
            expect(renderToStaticMarkup(
                <LocalizationProvider locale="ru" messages={{ common }}>
                    <LocalizationProvider {...page.props}><NamespaceProbe /></LocalizationProvider>
                </LocalizationProvider>,
            )).toContain(`${translated["hero.heading"]}|${common["loading.page"]}`);
        } finally { localeDefinitions.ru = original; }
    });
});
