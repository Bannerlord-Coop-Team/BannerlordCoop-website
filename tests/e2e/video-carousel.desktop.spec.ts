import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const viewports = [
    { width: 375, height: 812 },
    { width: 639, height: 800 },
    { width: 640, height: 800 },
    { width: 1023, height: 800 },
    { width: 1024, height: 800 },
    { width: 1375, height: 800 },
    { width: 1376, height: 800 },
    { width: 2560, height: 900 },
    { width: 639, height: 400 },
    { width: 1024, height: 700 },
    { width: 1024, height: 701 },
    { width: 1327, height: 700 },
    { width: 1328, height: 700 },
];

for (const deviceScaleFactor of [1, 2]) {
    for (const count of [2, 3]) {
        test(`thumbnail hints match layout: ${count} videos at ${deviceScaleFactor}x`, async ({ browser, baseURL }) => {
            const context = await browser.newContext({ baseURL, deviceScaleFactor });
            const page = await context.newPage();
            try {
                // Use the application's compiled CSS and actual component markup without external media data.
                await page.goto("/");
                const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => link.outerHTML).join(""));
                // Render outside Playwright's JSX transform, which creates test descriptors instead of React elements.
                const markup = execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/video-carousel.tsx", String(count)], { encoding: "utf8" });
                await page.setContent(`<html><head>${styles}<style>html { overflow-y: hidden; }</style></head><body><main class="site-container">${markup}</main></body></html>`);
                await expect(page.locator("main img")).toHaveCount(count);

                for (const viewport of viewports) {
                    await page.setViewportSize(viewport);
                    const measurements = await page.locator("main img").evaluateAll(async (images) => Promise.all(images.map(async (element) => {
                        const image = element as HTMLImageElement;
                        // Equal intrinsic/descriptor widths make naturalWidth expose the browser's evaluated sizes hint.
                        // These SVGs test sizing only; optimizer bandwidth is measured separately.
                        image.srcset = [256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840].map((width) => {
                            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}"/>`;
                            return `data:image/svg+xml,${encodeURIComponent(svg)} ${width}w`;
                        }).join(", ");
                        image.loading = "eager";
                        await image.decode();
                        return { rendered: image.getBoundingClientRect().width, hinted: image.naturalWidth };
                    })));
                    for (const measurement of measurements) {
                        expect(Math.abs(measurement.hinted - measurement.rendered), JSON.stringify({ viewport, deviceScaleFactor, count, ...measurement })).toBeLessThanOrEqual(1);
                    }
                }
            } finally {
                await context.close();
            }
        });
    }
}
