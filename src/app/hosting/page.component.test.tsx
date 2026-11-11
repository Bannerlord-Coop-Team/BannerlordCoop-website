import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import english from "@/app/lib/localization/dictionaries/en/hosting.json";
import russian from "@/app/lib/localization/dictionaries/ru/hosting.json";
import { HOSTING_OFFER_TIER, PATREON_HOSTING_CHECKOUT_URL } from "@/app/lib/hosting/patreon-checkout";
import { HOSTING_REGIONS } from "../../../supabase/functions/_shared/hosting-regions";

const request = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: request.locale }) }) }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
import HostingPage, { generateMetadata } from "./page";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

afterEach(() => { request.locale = undefined; });

async function render() {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await HostingPage());
    return root;
}

describe("hosting landing page", () => {
    it("gives search engines a hosting-specific title, description and canonical URL", async () => {
        expect(await generateMetadata()).toMatchObject({
            title: { absolute: english["metadata.title"] },
            description: english["metadata.description"].replace("{price}", "$20"),
            alternates: { canonical: "/hosting" },
            openGraph: { url: "/hosting", title: english["metadata.title"], locale: "en_US" },
        });
    });

    it("renders the offer, every catalog region, the FAQ and the Patreon checkout", async () => {
        const root = await render();
        expect(root.querySelector("h1")?.textContent).toBe(english["hero.heading"]);
        expect(root.textContent).toContain("$20/month");
        expect(root.textContent).toContain(`Patreon ${HOSTING_OFFER_TIER} tier`);
        for (const region of HOSTING_REGIONS) expect(root.textContent).toContain(region.label);
        expect(root.querySelectorAll("#faq-heading ~ dl dt")).toHaveLength(5);
        const checkout = [...root.querySelectorAll(`a[href='${PATREON_HOSTING_CHECKOUT_URL}']`)];
        expect(checkout).toHaveLength(2);
        for (const link of checkout) {
            expect(link.getAttribute("target")).toBe("_blank");
            expect(link.getAttribute("rel")).toBe("noopener noreferrer");
            expect(link.textContent).toBe(`${english["hero.cta"]} ${english["hero.newTab"]}`);
        }
    });

    it("publishes Organization, Product with a monthly USD offer, and FAQPage structured data", async () => {
        const root = await render();
        const scripts = root.querySelectorAll("script[type='application/ld+json']");
        expect(scripts).toHaveLength(1);
        const graph = JSON.parse(scripts[0].textContent!)["@graph"];
        expect(graph.map((node: { "@type": string }) => node["@type"])).toEqual(["Organization", "Product", "FAQPage"]);
        expect(graph[1].offers).toMatchObject({
            price: "20.00",
            priceCurrency: "USD",
            priceSpecification: { referenceQuantity: { unitCode: "MON", value: 1 } },
        });
        expect(graph[2].mainEntity[0]).toEqual({
            "@type": "Question",
            name: english["faq.different.question"],
            acceptedAnswer: { "@type": "Answer", text: english["faq.different.answer"] },
        });
    });

    it("renders the selected locale", async () => {
        request.locale = "ru";
        const root = await render();
        expect(root.querySelector("h1")?.textContent).toBe(russian["hero.heading"]);
        expect(root.textContent).toContain(russian["faq.friends.answer"]);
    });

    it("is listed in the sitemap, which robots.txt advertises", () => {
        const urls = sitemap().map((entry) => entry.url);
        expect(urls).toContain("https://bannerlordcoop.com/hosting");
        expect(urls).toContain("https://bannerlordcoop.com/cheats?lang=en");
        expect(urls.some((url) => /\/(account|admin|login)/u.test(url))).toBe(false);
        expect(robots()).toMatchObject({ sitemap: "https://bannerlordcoop.com/sitemap.xml" });
    });
});
