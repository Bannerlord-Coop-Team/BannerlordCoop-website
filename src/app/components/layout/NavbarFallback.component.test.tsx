import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// No locale cookie, so the label resolves in the default English dictionary.
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: () => undefined }),
}));
import { NavbarFallback } from "./NavbarFallback";

it("announces the navbar placeholder with the shared common loading label", async () => {
    const html = renderToStaticMarkup(await NavbarFallback());

    expect(html).toBe('<div role="status" aria-label="Loading navigation" class="h-16 border-b border-white/10 bg-background"></div>');
});
