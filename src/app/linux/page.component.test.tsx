import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import code from "./content/code.json";
import en from "./content/i18n/en.json";
import ru from "./content/i18n/ru.json";

const request = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: request.locale }) }) }));
vi.mock("@/app/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/app/components/layout/Footer", () => ({ Footer: () => null }));
import LinuxPage, { generateMetadata } from "./page";
import sitemap from "@/app/sitemap";

afterEach(() => { request.locale = undefined; });

async function render() {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await LinuxPage());
    return root;
}

const ubuntu = (code as Record<string, string>)["code-oneshot-ubuntu"];

describe("linux setup guide", () => {
    it("publishes a locale-specific title without an external share image", async () => {
        const metadata = await generateMetadata();
        expect(metadata.title).toEqual({ absolute: en.title });
        expect(metadata.description).toBe(en.description);
        expect(metadata.alternates).toEqual({ canonical: "/linux" });
        expect(metadata.openGraph).toMatchObject({ url: "/linux", images: [{ url: "/images/banner.png" }] });
        expect(JSON.stringify(metadata)).not.toContain("ship.place");
    });

    it("renders the menu, the untouched setup script, and no wrap control", async () => {
        const root = await render();
        expect(root.querySelector("#start-title")?.textContent).toBe("How do you want to set this up?");
        expect(root.textContent).toContain("Recommended");
        expect(root.textContent).toContain("Bash");
        const script = root.querySelector("#sec-terminal .code-pre code")?.textContent;
        expect(script).toBe(ubuntu);
        expect(script?.startsWith("cat > \"$HOME/coop-setup.sh\" <<'COOP_SETUP_EOF'\n#!/usr/bin/env bash\n")).toBe(true);
        const guide = root.querySelector("#linux-guide");
        expect(guide?.innerHTML).not.toContain("ship.place");
        expect(guide?.innerHTML.toLowerCase()).not.toContain("patreon");
        expect(guide?.innerHTML).not.toContain("workers.dev");
        expect(root.textContent).not.toMatch(/\bWrap\b/);
        expect(sitemap().map((entry) => entry.url)).toContain("https://bannerlordcoop.com/linux");
    });

    it("uses the site locale for guide prose and leaves the script unchanged", async () => {
        request.locale = "ru";
        const metadata = await generateMetadata();
        expect(metadata.title).toEqual({ absolute: ru.title });
        const root = await render();
        expect(root.querySelector("#start-title")?.textContent).toBe("Как ты хочешь это настроить?");
        expect(root.querySelector("#sec-terminal .code-pre code")?.textContent).toBe(ubuntu);
    });
});
