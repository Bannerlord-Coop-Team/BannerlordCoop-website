import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { LocalizationProvider } from "../lib/localization/client";
import common from "../lib/localization/dictionaries/en/common.json";
import english from "../lib/localization/dictionaries/en/cheats.json";
import german from "../lib/localization/dictionaries/de/cheats.json";
import commandsData from "./commands.json";
import type { CheatCommand } from "./CheatsDirectory";
import { CheatsView } from "./CheatsView";
import { PATREON_HOSTING_CHECKOUT_URL } from "../lib/hosting/patreon-checkout";
import { HostingOffer } from "./HostingOffer";
import { HOSTING_OFFER_COOKIE } from "./hostingOfferCookie";
import CheatsPage from "./page";
import { parseCheatsQuery } from "./query";

const request = vi.hoisted(() => ({ offerCookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({
    get: (name: string) => (name === "blcoop-locale" || request.offerCookie === undefined ? undefined : { name, value: request.offerCookie }),
}) }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const commands = (commandsData.commands as CheatCommand[]).slice(0, 3);
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    request.offerCookie = undefined;
    document.cookie = `${HOSTING_OFFER_COOKIE}=; Path=/cheats; Max-Age=0`;
    window.history.replaceState(null, "", "/");
});

/** Renders one rail offer to static markup with a single cheats dictionary. */
function renderOffer(locale: "en" | "de", cheats: typeof english) {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
        <LocalizationProvider locale={locale} messages={{ cheats }}>
            <HostingOffer layout="rail" onHide={() => {}} />
        </LocalizationProvider>,
    );
    return container.querySelector("aside")!;
}

/** Mounts the interactive client view on /cheats, where the path-scoped cookie is visible. */
function mountView(showHostingOffer: boolean) {
    window.history.replaceState(null, "", "/cheats");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(
        <LocalizationProvider locale="en" messages={{ cheats: english }}>
            <CheatsView commands={commands} initialQuery={parseCheatsQuery({})} showHostingOffer={showHostingOffer} />
        </LocalizationProvider>,
    ));
    return host;
}

/** Renders the actual server page under the root English provider. */
async function renderPage() {
    return renderToStaticMarkup(
        <LocalizationProvider locale="en" messages={{ common }} enabledLocales={[{ locale: "en", name: "English" }]}>
            {await CheatsPage({ searchParams: Promise.resolve({}) })}
        </LocalizationProvider>,
    );
}

it("sends the only call to action to the Veteran Patreon checkout in a new tab", () => {
    const offer = renderOffer("en", english);
    const title = offer.querySelector(`[id="${offer.getAttribute("aria-labelledby")}"]`)!;

    expect(title.tagName).toBe("P");
    expect(title.textContent).toBe("Rent a Server");
    expect(offer.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(offer.textContent).toContain("Official hosting");
    for (const feature of ["Online 24/7, no PC left on", "Automatic daily backups", "Game updates handled for you", "Priority support"]) {
        expect(offer.textContent).toContain(feature);
    }
    expect(offer.textContent).toContain("$20/month");
    expect(offer.textContent).toContain("Patreon Veteran tier");
    expect(offer.textContent).toContain("Elite and Noble patrons get it too.");

    const links = offer.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(PATREON_HOSTING_CHECKOUT_URL).toBe("https://www.patreon.com/checkout/BannerlordCoop?rid=28995946");
    expect(links[0].getAttribute("href")).toBe(PATREON_HOSTING_CHECKOUT_URL);
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    // The accessible name starts with the visible label and announces the new tab.
    expect(links[0].textContent).toBe("Get your server (opens Patreon in a new tab)");

    const image = offer.querySelector("img")!;
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("src")).toContain(encodeURIComponent("/images/hosting/riders-band.webp"));
    expect(offer.querySelector("button")?.getAttribute("aria-label")).toBe("Hide hosting offer");
});

it("formats the USD price per locale and keeps the Patreon tier name", () => {
    const offer = renderOffer("de", german);
    const price = new Intl.NumberFormat("de", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(20);

    expect(offer.textContent).toContain("Server mieten");
    expect(offer.textContent).toContain(`${price}/Monat`);
    expect(offer.textContent).toContain("Patreon-Stufe Veteran");
    expect(offer.querySelector("a")?.textContent).toBe("Hol dir deinen Server (öffnet Patreon in einem neuen Tab)");
});

it("hides both placements together and remembers the dismissal for /cheats", () => {
    const view = mountView(true);
    const rail = view.querySelector('[aria-labelledby="hosting-offer-rail"]')!;
    const inline = view.querySelector('[aria-labelledby="hosting-offer-inline"]')!;

    // The rail column only pins on viewports tall enough to show the whole card.
    expect(rail.parentElement?.className).toBe("hidden min-w-0 xl:block xl:[@media(min-height:50rem)]:sticky xl:[@media(min-height:50rem)]:top-20");
    expect(rail.parentElement?.parentElement?.className).toContain("xl:grid-cols-[13rem_minmax(0,1fr)_18.75rem]");
    expect(inline.parentElement?.className).toBe("mt-8 xl:hidden");

    act(() => inline.querySelector("button")!.click());

    expect(view.querySelector('[aria-labelledby^="hosting-offer-"]')).toBeNull();
    expect(view.innerHTML).not.toContain("18.75rem");
    expect(document.cookie).toContain(`${HOSTING_OFFER_COOKIE}=hidden`);
    expect(document.activeElement?.id).toBe("cheat-search");
});

it("omits both placements from the server render once dismissed", async () => {
    request.offerCookie = "hidden";
    const hidden = await renderPage();
    expect(hidden).not.toContain("hosting-offer-");
    expect(hidden).not.toContain("18.75rem");

    request.offerCookie = "unexpected";
    const shown = await renderPage();
    expect(shown).toContain('aria-labelledby="hosting-offer-rail"');
    expect(shown).toContain('aria-labelledby="hosting-offer-inline"');
});
