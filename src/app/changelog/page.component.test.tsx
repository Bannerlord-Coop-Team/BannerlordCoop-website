import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localeDefinitions } from "@/app/lib/localization/registry";
import type { Dictionary } from "@/app/lib/localization/types";
import type { GitHubRelease } from "@/app/lib/github-releases";
import english from "@/app/lib/localization/dictionaries/en/changelog.json";
import { assertDictionaryParity } from "@/app/lib/localization/integrity";

const request = vi.hoisted(() => ({ locale: undefined as string | undefined, releases: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: request.locale }) }) }));
vi.mock("@/app/lib/github-releases.ts", () => ({
    GITHUB_RELEASES_URL: "https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases",
    getGitHubReleases: request.releases,
}));
vi.mock("@/app/components/layout/Navbar.tsx", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer.tsx", () => ({ Footer: () => null }));
import ChangelogPage, { generateMetadata } from "./page";

const release: GitHubRelease = {
    id: 41,
    tagName: "v1.2.3",
    name: "External release name {date}",
    href: "https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases/tag/v1.2.3",
    body: "# External heading\n\nOriginal **release prose** and `coop.command` by {author}.\n\n- [External link](https://example.com/notes)",
    publishedAt: "2026-09-30T23:30:00Z",
    author: "SourceAuthor{date}",
    prerelease: true,
};

// Complete test-only locale data verifies that page behavior does not need locale-specific code.
const spanish: Dictionary = {
    "metadata.title": "Cambios",
    "metadata.description": "Versiones de Bannerlord Coop.",
    "hero.eyebrow": "Actualizaciones",
    "hero.title": "Cambios de Bannerlord Coop",
    "hero.description": "Mejoras del equipo de desarrollo.",
    "links.githubReleases": "Ver versiones en GitHub",
    "links.fullRelease": "Ver versión completa",
    "links.openGithubReleases": "Abrir versiones de GitHub",
    "history.eyebrow": "Historial",
    "history.title": "¿Qué cambió?",
    "history.description": "Información de GitHub actualizada cada hora.",
    "history.count": { one: "{formattedCount} versión disponible", other: "{formattedCount} versiones disponibles" },
    "release.latest": "Última versión",
    "release.label": "Versión",
    "release.prerelease": "Versión preliminar",
    "release.published": "{date}: publicación",
    "release.publishedUnknown": "Fecha de publicación desconocida",
    "release.author": "{author}: autor",
    "release.emptyNotes": "No hay notas para esta versión.",
    "unavailable.eyebrow": "GitHub no disponible",
    "unavailable.title": "No se pudo cargar el historial.",
    "unavailable.description": "Consulta las versiones directamente en GitHub.",
    "empty.eyebrow": "Sin versiones",
    "empty.title": "El historial está vacío.",
    "empty.description": "Las versiones publicadas aparecerán aquí.",
};
const originalSpanish = localeDefinitions.es;

beforeEach(() => {
    localeDefinitions.es = { ...originalSpanish, enabled: false };
    request.locale = undefined;
    request.releases.mockReset();
    request.releases.mockResolvedValue({ releases: [release], isAvailable: true });
});
afterEach(() => { localeDefinitions.es = originalSpanish; });

/** Activates only test-owned dictionary data, leaving the production locale disabled. */
function selectSpanish() {
    localeDefinitions.es = { ...originalSpanish, enabled: true, dictionaries: { changelog: async () => ({ default: spanish }) } };
    request.locale = "es";
}

/** Renders the real page with mocked release transport and no shared chrome dependencies. */
async function renderPage() {
    const page = await ChangelogPage();
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(page);
    return { page, container };
}

it.each([undefined, "invalid-locale", "es"])("keeps metadata and page English for an absent, invalid, or disabled cookie (%s)", async (cookie) => {
    request.locale = cookie;
    const { page, container } = await renderPage();
    expect(page.props.locale).toBe("en");
    expect(Object.keys(page.props.messages)).toEqual(["changelog"]);
    expect(page.props.messages.changelog).toEqual(english);
    expect(await generateMetadata()).toEqual({ title: "Changelog", description: english["metadata.description"] });
    expect(container.querySelector("h1")?.textContent).toBe("Bannerlord Coop Changelog");
    expect(container.textContent).toContain("Showing 1 release");
    expect(container.querySelector("time")?.textContent).toBe("Published September 30, 2026");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(release.publishedAt);
});

it("preserves external release names, markdown, author, tags, and links while translating all surrounding presentation", async () => {
    selectSpanish();
    assertDictionaryParity(english, spanish, "test.es.changelog");
    request.releases.mockResolvedValue({ releases: [release, { ...release, id: 42, author: null, prerelease: false }], isAvailable: true });
    const { page, container } = await renderPage();
    expect(page.props.locale).toBe("es");
    expect(page.props.messages).toEqual({ changelog: spanish });
    expect(await generateMetadata()).toEqual({ title: spanish["metadata.title"], description: spanish["metadata.description"] });
    for (const key of ["hero.eyebrow", "hero.title", "hero.description", "links.githubReleases", "links.fullRelease", "history.eyebrow", "history.title", "history.description", "release.latest", "release.label", "release.prerelease"]) {
        expect(container.textContent).toContain(spanish[key]);
    }
    expect(container.textContent).toContain("2 versiones disponibles");
    const date = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(release.publishedAt));
    expect(container.querySelector("time")?.textContent).toBe(`${date}: publicación`);
    expect(container.textContent).toContain(`${release.author}: autor`);
    expect(container.textContent).toContain(release.name);
    expect(container.textContent).toContain(release.tagName);
    expect(container.textContent).toContain("External heading");
    expect(container.textContent).toContain("Original release prose and coop.command by {author}.");
    expect(container.querySelector("code")?.textContent).toBe("coop.command");
    expect(container.querySelector('a[href="https://example.com/notes"]')?.textContent).toBe("External link");
    expect(container.querySelector(`a[href="${release.href}"]`)?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector('article[aria-labelledby="release-41"] h3')?.id).toBe("release-41");
    expect(request.releases).toHaveBeenCalledExactlyOnceWith();
});

it("localizes missing release notes and invalid dates as whole messages", async () => {
    selectSpanish();
    request.releases.mockResolvedValue({ releases: [{ ...release, body: " \n ", publishedAt: "invalid-date" }], isAvailable: true });
    const { container } = await renderPage();
    expect(container.textContent).toContain("1 versión disponible");
    expect(container.textContent).toContain(spanish["release.emptyNotes"]);
    expect(container.querySelector("time")?.textContent).toBe(spanish["release.publishedUnknown"]);
    expect(container.textContent).not.toContain("Published");
});

it.each([true, false])("localizes empty/unavailable status presentation (available=%s)", async (isAvailable) => {
    selectSpanish();
    request.releases.mockResolvedValue({ releases: [], isAvailable });
    const { container } = await renderPage();
    const status = container.querySelector('[role="status"]');
    const prefix = isAvailable ? "empty" : "unavailable";
    for (const key of ["eyebrow", "title", "description"]) {
        expect(status?.textContent).toContain(spanish[`${prefix}.${key}`]);
    }
    expect(container.querySelector("article")).toBeNull();
    expect(container.textContent).not.toContain("versiones disponibles");
    if (!isAvailable) {
        expect(status?.querySelector("a")?.textContent).toBe(spanish["links.openGithubReleases"]);
        expect(status?.querySelector("a")?.href).toBe("https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases");
    }
});

it("retains English plural, invalid-date, and empty-notes presentation", async () => {
    request.releases.mockResolvedValue({ releases: [release, { ...release, id: 42, body: "", publishedAt: "invalid" }], isAvailable: true });
    const { container } = await renderPage();
    expect(container.textContent).toContain("Showing 2 releases");
    expect(container.textContent).toContain("Published on an unknown date");
    expect(container.textContent).toContain("No release notes were provided for this version.");
});
