import { expect, test } from "@playwright/test";

test.describe("homepage display", () => {
    test("displays the main homepage sections", async ({ page }) => {
        await page.goto("/");

        await expect(page).toHaveTitle(/Bannerlord Co-op/);
        await expect(page.getByRole("heading", {level: 1, name: /Forge Alliances Wage War Shared Calradia/i,}),).toBeVisible();

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

        const hero = page.getByRole("region", {name: /Forge Alliances/,});

        await hero.getByRole("button", {name: /Download/,}).click();
        await expect(page.getByRole("dialog", {name: "Choose A Platform",})).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        const rentServerLink = page.getByRole("link", {name: /Rent a Server.*\(opens Patreon in a new tab\)/,});

        await expect(rentServerLink).toHaveAttribute("href", "https://www.patreon.com/checkout/BannerlordCoop?rid=28995946");
        await expect(rentServerLink).toHaveAttribute("target", "_blank");
        await expect(rentServerLink).toHaveAttribute("rel", "noopener noreferrer");

        const discordLink = page.getByRole("link", {name: "Join the Discord",});

        await expect(discordLink).toHaveAttribute("href","https://discord.gg/bannerlordcoop",);
        await expect(discordLink).toHaveAttribute("target", "_blank");
    });
});