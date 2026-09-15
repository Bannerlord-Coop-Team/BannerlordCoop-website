import { expect, test } from "@playwright/test";

test.describe("homepage display", () => {
    test("displays the main homepage sections", async ({ page }) => {
        await page.goto("/");

        await expect(page).toHaveTitle(/Bannerlord Coop/);
        await expect(page.getByRole("heading", {level: 1, name: /Rally The Warband Raise The Banner Conquer Calradia/i,}),).toBeVisible();

        await expect(page.getByRole("banner")).toBeVisible();
        await expect(page.getByRole("main")).toBeVisible();
        await expect(page.getByRole("contentinfo")).toBeVisible();

        await expect(page.locator("#media")).toBeVisible();
        await expect(page.locator("#features")).toBeVisible();
        await expect(page.locator("#roadmap")).toBeVisible();
        await expect(page.locator("#about")).toBeVisible();
        await expect(page.locator("#download")).toBeVisible();
    });

    test("does not overflow the viewport", async ({ page }) => {
        await page.goto("/");

        const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth,);

        expect(hasHorizontalOverflow).toBe(false);
    });

    test("provides working homepage calls to action", async ({ page }) => {
        await page.goto("/");

        const downloadLink = page.getByRole("link", {name: "Ride To Conquest",});

        await expect(downloadLink).toHaveAttribute("href", "#download");
        await downloadLink.click();
        await expect(page.locator("#download")).toBeInViewport();

        const discordLink = page.getByRole("link", {name: "Join the Discord",});

        await expect(discordLink).toHaveAttribute("href","https://discord.gg/bannerlordcoop",);
        await expect(discordLink).toHaveAttribute("target", "_blank");
    });
});