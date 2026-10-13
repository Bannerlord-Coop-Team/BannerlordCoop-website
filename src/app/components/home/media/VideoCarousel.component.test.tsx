import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalizationProvider } from "@/app/lib/localization/client";
import home from "@/app/lib/localization/dictionaries/en/home.json";
import { VideoCarousel } from "./VideoCarousel";

describe("video thumbnail sizing", () => {
    it.each([1, 2, 3])("keeps responsive lazy images and accessible links with %i videos", (count) => {
        const videos = Array.from({ length: count }, (_, index) => ({
            id: String(index), title: `Video ${index}`, thumbnail: "/images/banner.png",
            thumbnailAlt: `Thumbnail ${index}`, category: "Community", href: `https://example.com/video/${index}`,
            description: "", duration: null,
        }));
        const host = document.createElement("div");
        host.innerHTML = renderToStaticMarkup(
            <LocalizationProvider locale="en" messages={{ home }}>
                <VideoCarousel videos={videos} />
            </LocalizationProvider>,
        );
        const images = [...host.querySelectorAll("img")];
        expect(images).toHaveLength(count);
        for (const [index, image] of images.entries()) {
            expect(image.alt).toBe(videos[index].thumbnailAlt);
            expect(image.getAttribute("loading")).toBe("lazy");
            expect(image.getAttribute("data-nimg")).toBe("fill");
            // Small screens must retain sub-640px optimizer candidates even with calc/min sizes.
            const widths = image.srcset.split(", ").map((candidate) => Number(candidate.match(/ (\d+)w$/)?.[1]));
            expect(widths).toEqual(expect.arrayContaining([384, 640, 1080, 1920]));
            expect(image.sizes).not.toBe("(min-width: 1024px) 50vw, 100vw");
            const link = image.closest("a")!;
            expect(link.href).toBe(videos[index].href);
            expect(link.target).toBe("_blank");
            expect(link.rel).toBe("noopener noreferrer");
        }
    });
});
