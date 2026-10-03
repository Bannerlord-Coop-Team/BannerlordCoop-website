import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotFound from "./not-found";
import { LocalizationProvider, useTranslations } from "@/app/lib/localization/client";
import { assertDictionaryParity } from "@/app/lib/localization/integrity";
import { localeDefinitions } from "@/app/lib/localization/registry";
import english from "@/app/lib/localization/dictionaries/en/not-found.json";

const request = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: (name: string) => name === "blcoop-locale" ? { value: request.locale } : undefined }),
}));

const translated = {
    "links.brandHome": "Inicio de {brand}",
    "error.code": "Código de error {code}",
    "heading": "No hay ninguna página que mostrar.",
    "description": "La página puede haberse movido, haberse eliminado o no haber existido. Vuelve al inicio o consulta el directorio de servidores.",
    "links.home": "Volver al inicio",
    "links.servers": "Explorar servidores",
    "footer.motto": "Ningún estandarte se alza sin amigos",
};

afterEach(() => { request.locale = undefined; });

/** Verifies that the page also delivers its request-selected namespace to client consumers. */
function NotFoundProbe() {
    const { t, locale } = useTranslations("not-found");
    return <p lang={locale}>{t("heading")}</p>;
}

/** Parses rendered output for focused structure, decorative-image, and recovery-link assertions. */
function pageDocument(html: string) {
    return new DOMParser().parseFromString(html, "text/html");
}

describe("NotFound localization", () => {
    it.each([undefined, "en", "invalid", "zh-CN"])("preserves English recovery content for cookie %s", async (locale) => {
        request.locale = locale;
        const page = await NotFound();
        expect(page.type).toBe(LocalizationProvider);
        expect(page.props.locale).toBe("en");
        expect(Object.keys(page.props.messages)).toEqual(["not-found"]);
        const document = pageDocument(renderToStaticMarkup(page));
        expect(document.querySelector("h1")?.textContent).toBe("No page to be displayed.");
        expect(document.querySelector("main")?.textContent).toContain("Error 404");
        expect(document.querySelector("main")?.textContent).toContain(english.description);
        expect(document.querySelector("footer")?.textContent).toBe("No banner rises without friends");
        const links = [...document.querySelectorAll("a")];
        expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/", "/servers"]);
        expect(links[0].getAttribute("aria-label")).toBe("Bannerlord Coop home");
        expect(links[0].textContent).toBe("Bannerlord Coop");
        expect(links[1].textContent).toBe("Return home");
        expect(links[2].textContent).toBe("Browse servers");
        expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
        expect([...document.querySelectorAll("svg")].every((icon) => icon.getAttribute("aria-hidden") === "true")).toBe(true);
    });

    it("localizes every message and accessible link name from activated dictionary data", async () => {
        const original = localeDefinitions.es;
        localeDefinitions.es = {
            ...original,
            enabled: true,
            dictionaries: { "not-found": async () => ({ default: translated }) },
        };
        request.locale = "es";
        try {
            assertDictionaryParity(english, translated, "es.not-found");
            const page = await NotFound();
            expect(page.props.locale).toBe("es");
            expect(Object.keys(page.props.messages)).toEqual(["not-found"]);
            const document = pageDocument(renderToStaticMarkup(page));
            expect(document.querySelector("h1")?.textContent).toBe(translated.heading);
            expect(document.querySelector("main")?.textContent).toContain("Código de error 404");
            expect(document.querySelector("main")?.textContent).toContain(translated.description);
            expect(document.querySelector("footer")?.textContent).toBe(translated["footer.motto"]);
            const links = [...document.querySelectorAll("a")];
            expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/", "/servers"]);
            expect(links[0].getAttribute("aria-label")).toBe("Inicio de Bannerlord Coop");
            expect(links[0].textContent).toBe("Bannerlord Coop");
            expect(links[1].textContent).toBe(translated["links.home"]);
            expect(links[2].textContent).toBe(translated["links.servers"]);
            expect(renderToStaticMarkup(
                <LocalizationProvider locale={page.props.locale} messages={page.props.messages}>
                    <NotFoundProbe />
                </LocalizationProvider>,
            )).toBe(`<p lang="es">${translated.heading}</p>`);
        } finally { localeDefinitions.es = original; }
    });
});
