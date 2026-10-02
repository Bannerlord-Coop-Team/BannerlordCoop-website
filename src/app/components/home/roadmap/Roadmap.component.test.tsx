import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslations } from "@/app/lib/localization/server";
import { createTranslator } from "@/app/lib/localization/translator";
import home from "@/app/lib/localization/dictionaries/en/home.json";
import { renderToStaticMarkup } from "react-dom/server";
import { Roadmap } from "./Roadmap";
import { getRoadmap, type RoadmapItem } from "@/app/lib/roadmap";

vi.mock("@/app/lib/roadmap", () => ({ getRoadmap: vi.fn() }));
vi.mock("@/app/lib/localization/server", () => ({ getTranslations: vi.fn() }));
beforeEach(() => { vi.mocked(getTranslations).mockResolvedValue(createTranslator("en", home)); });

afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

// Creates an unkeyed live row to protect source-content preservation.
const item = (title: string, status: RoadmapItem["status"]): RoadmapItem => ({
    id: title, title, status, description: "",
});

describe("Roadmap", () => {
    it("collapses complete milestones and renders status columns with cards ordered within each column", async () => {
        vi.mocked(getRoadmap).mockResolvedValue([
            { id: "old", title: "v0.1", roadmap_items: [item("Movement", "completed")] },
            { id: "current", title: "V1.0 - The Game", roadmap_items: [
                item("Arena", "planned"),
                { ...item("Trading", "completed"), description: "Player-to-player" },
                item("Sieges", "experimental"),
                item("Hideout", "in_progress"),
                item("Quests", "in_progress"),
            ] },
        ]);
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(await Roadmap());
        const groups = root.querySelectorAll("details");
        expect(groups[0].open).toBe(false);
        expect(groups[0].querySelector("summary")?.textContent).toBe("v0.11 of 1 completed");
        expect(groups[1].open).toBe(true);
        expect(groups[1].querySelector("summary")?.textContent).toBe("V1.0The Game1 of 5 completed");
        expect([...groups[1].querySelectorAll("h5")].map((node) => node.textContent))
            .toEqual(["Arena", "Hideout", "Quests", "Sieges", "Trading"]);
        expect(groups[1].querySelectorAll("li > span")).toHaveLength(0);
        expect(groups[1].querySelector("h3 span")?.textContent).toBe("V1.0");
        expect(groups[1].textContent).toContain("Implemented, but not yet reliable.");
        expect([...groups[1].querySelectorAll("ul")].map((node) => node.getAttribute("aria-label")))
            .toEqual(["Planned", "In Progress", "Experimental", "Completed"]);
        const experimentalList = groups[1].querySelector('ul[aria-label="Experimental"]');
        expect(experimentalList?.previousElementSibling?.tagName).toBe("H4");
        expect(experimentalList?.nextElementSibling?.textContent).toBe("Implemented, but not yet reliable.");
        expect(groups[0].querySelectorAll("ul")).toHaveLength(1);
        expect(groups[0].querySelector("ul")?.className).toContain("auto-fit");
        expect(groups[0].querySelector("ul")?.parentElement?.parentElement?.className).not.toContain("xl:grid-cols-4");
        expect(groups[1].querySelector("ul")?.className).toContain("flex-col");
        expect(groups[1].querySelector("ul")?.parentElement?.parentElement?.className).toContain("xl:grid-cols-4");
        expect(groups[1].textContent).toContain("Player-to-player");
    });

    // Matrix: explicit keys translate; identical unkeyed source text must not be matched or replaced.
    it("renders mapped titles/descriptions and preserves unkeyed content in the same milestone", async () => {
        vi.mocked(getTranslations).mockResolvedValue(createTranslator("ru", {
            ...home,
            "roadmap.milestone.v1-0.title": "V1.0 - Translated milestone",
            "roadmap.item.trading.title": "Translated trading",
            "roadmap.item.trading.description": "Translated description",
            "roadmap.status.planned": "Translated planned",
            "roadmap.progress": "{completed}/{total} done",
        }));
        vi.mocked(getRoadmap).mockResolvedValue([
            { id: "mapped", title: "Original milestone", title_translation_key: "roadmap.milestone.v1-0.title", roadmap_items: [
                { ...item("Trading", "planned"), id: "mapped-item", title_translation_key: "roadmap.item.trading.title", description: "Original description", description_translation_key: "roadmap.item.trading.description" },
                { ...item("Trading", "planned"), description: "Source description" },
            ] },
            { id: "new", title: "New live milestone", roadmap_items: [] },
        ]);
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(await Roadmap());
        expect(root.textContent).toContain("V1.0Translated milestone0/2 done");
        expect([...root.querySelectorAll("h5")].map((node) => node.textContent?.trim())).toEqual(["Translated trading", "Trading"]);
        expect(root.textContent).toContain("Translated description");
        expect(root.textContent).toContain("Source description");
        expect(root.textContent).toContain("New live milestone");
        expect(root.querySelector('ul[aria-label="Translated planned"]')).not.toBeNull();
        expect(root.textContent).not.toContain("Original description");
        expect(root.textContent).toContain(home["roadmap.empty"]);
    });

    it("omits the section when no roadmap is available", async () => {
        vi.mocked(getRoadmap).mockResolvedValue([]);
        expect(await Roadmap()).toBeNull();
    });
});

it("loads ordered milestones and nested items using public credentials with a short cache", async () => {
    const { getRoadmap: load } = await vi.importActual<typeof import("@/app/lib/roadmap")>("@/app/lib/roadmap");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const rows = [{ id: "one", title: "v1.0", title_translation_key: "roadmap.milestone.v1-0.title", roadmap_items: [{ ...item("Trading", "planned"), title_translation_key: "roadmap.item.trading.title", description_translation_key: null }] }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    vi.stubGlobal("fetch", fetchMock);
    expect(await load()).toEqual(rows);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get("select")).toBe("id,title,title_translation_key,roadmap_items(id,title,title_translation_key,description,description_translation_key,status)");
    expect(new URL(url).searchParams.get("order")).toBe("sort_order.asc,id.asc");
    expect(new URL(url).searchParams.get("roadmap_items.order")).toBe("sort_order.asc,id.asc");
    expect(options).toEqual({ headers: { apikey: "public-test-key" }, next: { revalidate: 60 } });

    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await load()).toEqual([]);
    log.mockRestore();
});
