import { act, cloneElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home, { generateMetadata } from "@/app/page";
import { ActiveGroups } from "./community/ActiveGroups";
import { VideoCarousel } from "./media/VideoCarousel";
import { CommunityMedia } from "./media/CommunityMedia";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { localeDefinitions } from "@/app/lib/localization/registry";
import home from "@/app/lib/localization/dictionaries/en/home.json";
import common from "@/app/lib/localization/dictionaries/en/common.json";
import { getHomepageVideos } from "@/app/lib/homepage-videos";
import type { Dictionary } from "@/app/lib/localization/types";

const request = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: request.value }) }) }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/app/components/motion/ScrollReveal", () => ({ ScrollReveal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/app/lib/network-stats", () => ({ getNetworkStats: async () => ({ playersOnline: 12345, dedicatedServersCount: null, battlesFoughtTotal: 12, totalDownloads: 45678 }) }));
vi.mock("@/app/lib/roadmap", () => ({ getRoadmap: async () => [] }));
vi.mock("@/app/lib/homepage-videos", () => ({ getHomepageVideos: vi.fn(async () => [{ id: "video", title: "Source video", description: "Source description", category: "Source category", thumbnail: "/images/banner.png", thumbnailAlt: "Source alternative", href: "https://example.com/video", duration: "1:23" }]) }));
vi.mock("@/app/lib/youtube", () => ({ getYouTubeCreators: async () => [{ id: "creator", name: "Source creator", description: "Source creator description", avatar: "/images/banner.png", href: "https://example.com/creator" }] }));

afterEach(() => { request.value = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Resolves async server leaves before ordinary React SSR, keeping client hooks inside their provider.
async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
    if (Array.isArray(node)) {
        const children = await Promise.all(node.map(resolveServerTree));
        return children.map((child, index) => isValidElement(child) ? cloneElement(child, { key: child.key ?? index }) : child);
    }
    if (!isValidElement<{ children?: ReactNode }>(node)) return node;
    if (typeof node.type === "function" && node.type.constructor.name === "AsyncFunction") {
        return resolveServerTree(await (node.type as (props: unknown) => Promise<ReactNode>)(node.props));
    }
    if (!node.props.children) return node;
    return cloneElement(node, {}, await resolveServerTree(node.props.children));
}

// Wraps a resolved server tree in the same root common provider used in production.
async function markup(node: ReactNode, dictionary: Dictionary = home, locale: "en" | "ru" = "en") {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<LocalizationProvider locale={locale} messages={{ common, home: dictionary }}>{await resolveServerTree(node)}</LocalizationProvider>);
    return root;
}

// Matrix: default/activated-data SSR; keyed/unkeyed editorial media; live values; client pagination.
describe("home localization", () => {
    it("delivers home-only page messages with English SSR/client copy, formatted statistics and metadata", async () => {
        const page = await Home();
        expect(page.props.locale).toBe("en");
        expect(Object.keys(page.props.messages)).toEqual(["home"]);
        const root = await markup(page);
        expect(root.textContent).toContain("Rally The WarbandRaise The BannerConquer Calradia");
        expect(root.textContent).toContain("12,345");
        expect(root.textContent).toContain("Not available");
        expect(root.querySelector("video")?.getAttribute("aria-label")).toBe(home["trailer.label"]);
        expect(root.querySelector("video a")?.getAttribute("href")).toContain("bannerlord-coop-trailer-v4.mp4");
        expect(root.querySelector('a[href="#download"]')?.textContent).toContain(home["hero.download"]);
        expect(await generateMetadata()).toMatchObject({ description: home["metadata.description"], alternates: { canonical: "/" }, openGraph: { locale: "en_US", title: "Bannerlord Coop", description: home["metadata.description"] }, twitter: { description: home["metadata.description"] } });
    });

    it("renders all available homepage prose from activated data and preserves external media", async () => {
        const original = localeDefinitions.ru;
        const translated = Object.fromEntries(Object.entries(home).map(([key, value]) => [key, typeof value === "string" ? `Localized ${key}: ${value}` : value])) as Dictionary;
        localeDefinitions.ru = { ...original, enabled: true, dictionaries: { home: async () => ({ default: translated }) } };
        request.value = "ru";
        try {
            const page = await Home();
            const root = await markup(page, translated, "ru");
            expect(page.props.locale).toBe("ru");
            const omitted = /^(roadmap\.|servers\.|carousel\.|metadata\.|media\.(fallbackTitle|videoThumbnail|fallbackThumbnail|captainfracas-twitch\..*)$)/;
            for (const key of Object.keys(home).filter((key) => !omitted.test(key))) {
                // Avatar and trailer accessibility messages are in attributes rather than text nodes.
                expect(root.innerHTML).toContain(`Localized ${key}:`);
            }
            expect(root.textContent).toContain(new Intl.NumberFormat("ru").format(12345));
            expect(root.textContent).toContain("Source video");
            expect(root.textContent).toContain("Source creator description");
            expect(root.querySelector('a[href="https://example.com/video"]')).not.toBeNull();
            expect(await generateMetadata()).toMatchObject({ description: translated["metadata.description"], openGraph: { locale: "ru_RU" } });
            const labels = vi.mocked(getHomepageVideos).mock.calls.at(-1)?.[0];
            expect(labels?.fallbackTitle).toBe(translated["media.fallbackTitle"]);
            expect(labels?.videoThumbnail("Original title")).toContain("Original title");
        } finally { localeDefinitions.ru = original; }
    });

    // Exercises editorial presentation with translated data and an identical but unkeyed custom row.
    it("translates keyed Twitch editorial fields and preserves unkeyed media and external content", async () => {
        const original = localeDefinitions.ru;
        const translated = {
            ...home,
            "media.captainfracas-twitch.description": "Localized description with CaptainFRACAS",
            "media.captainfracas-twitch.thumbnailAlt": "Localized alternative with CaptainFRACAS",
            "media.captainfracas-twitch.category": "Localized category with CaptainFRACAS on Twitch",
        };
        localeDefinitions.ru = { ...original, enabled: true, dictionaries: { home: async () => ({ default: translated }) } };
        request.value = "ru";
        const source = {
            id: "twitch-seed",
            title: "Bannerlord Coop — L'empire contre-attaque!",
            description: home["media.captainfracas-twitch.description"],
            thumbnail: "https://example.com/source-thumbnail.jpg",
            thumbnailAlt: home["media.captainfracas-twitch.thumbnailAlt"],
            category: home["media.captainfracas-twitch.category"],
            href: "https://www.twitch.tv/videos/2827818732?t=04h20m50s",
            duration: "7:06:10",
        };
        vi.mocked(getHomepageVideos).mockResolvedValueOnce([
            { ...source, description_translation_key: "media.captainfracas-twitch.description", thumbnail_alt_translation_key: "media.captainfracas-twitch.thumbnailAlt", category_translation_key: "media.captainfracas-twitch.category" },
            { ...source, id: "unkeyed", href: "https://example.com/unkeyed", description_translation_key: null, thumbnail_alt_translation_key: null, category_translation_key: null },
        ]);
        try {
            const root = await markup(await CommunityMedia(), translated, "ru");
            const keyed = root.querySelector(`a[href="${source.href}"]`)!;
            expect(keyed.textContent).toContain(translated["media.captainfracas-twitch.description"]);
            expect(keyed.textContent).toContain(translated["media.captainfracas-twitch.category"]);
            expect(keyed.querySelector("img")?.alt).toBe(translated["media.captainfracas-twitch.thumbnailAlt"]);
            const unkeyed = root.querySelector('a[href="https://example.com/unkeyed"]')!;
            expect(unkeyed.textContent).toContain(source.description);
            expect(unkeyed.textContent).toContain(source.category);
            expect(unkeyed.querySelector("img")?.alt).toBe(source.thumbnailAlt);
            for (const card of [keyed, unkeyed]) {
                expect(card.textContent).toContain(source.title);
                expect(card.textContent).toContain(source.duration);
                expect(decodeURIComponent(card.querySelector("img")!.src)).toContain(source.thumbnail);
            }
            expect(root.textContent).toContain("Source creator");
            expect(root.querySelector('a[href="https://example.com/creator"]')).not.toBeNull();
        } finally { localeDefinitions.ru = original; }
    });

    it("localizes active-server columns/status/empty copy without translating server values", async () => {
        const root = await markup(await ActiveGroups({ lastUpdated: "source timestamp", servers: [{ id: "one", server: "My Server", region: "Custom region", mode: "Custom mode", warriors: 1000, maxWarriors: 2000, ping: 42, status: "Online" }] }));
        expect(root.textContent).toContain("Updated source timestamp");
        expect(root.textContent).toContain("My Server");
        expect(root.textContent).toContain("Custom region");
        expect(root.textContent).toContain("Custom mode");
        expect(root.textContent).toContain("1,000");
        expect(root.textContent).toContain("42 ms");
        expect([...root.querySelectorAll("th")].map((node) => node.textContent?.trim())).toEqual(["Server", "Region", "Mode", "Warriors", "Ping", "Status"]);
        const empty = await markup(await ActiveGroups({ servers: [] }));
        expect(empty.textContent).toContain(home["servers.emptyDescription"]);
    });

    it("uses translated accessible pagination labels and counts while preserving video source text", async () => {
        vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
        // Provides deterministic carousel dimensions without layout or network dependencies.
        class ResizeObserverFixture {
            // The component measures immediately; there is no asynchronous resize in this fixture.
            observe() {}
            // Releases the fixture observer without side effects.
            disconnect() {}
        }
        vi.stubGlobal("ResizeObserver", ResizeObserverFixture);
        vi.stubGlobal("matchMedia", () => ({ matches: true }));
        vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
        const scrollTo = vi.fn();
        const originalScrollTo = HTMLElement.prototype.scrollTo;
        HTMLElement.prototype.scrollTo = scrollTo;
        const host = document.createElement("div");
        const root = createRoot(host);
        const dictionary = { ...home, "carousel.next": "Next translated", "carousel.previous": "Previous translated", "carousel.goTo": "Page translated {page}", "carousel.page": "{page}/{total}" };
        const video = (await getHomepageVideos())[0];
        try {
            await act(async () => { root.render(<LocalizationProvider locale="en" messages={{ home: dictionary }}><VideoCarousel videos={[0, 1, 2].map((id) => ({ ...video, id: String(id) }))} /></LocalizationProvider>); });
            expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("1/3");
            expect(host.querySelector('[aria-label="Page translated 3"]')).not.toBeNull();
            await act(async () => { (host.querySelector('[aria-label="Next translated"]') as HTMLButtonElement).click(); });
            expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("2/3");
            expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: "auto" });
            expect(host.textContent).toContain("Source video");
        } finally {
            await act(async () => { root.unmount(); });
            HTMLElement.prototype.scrollTo = originalScrollTo;
        }
    });
});
