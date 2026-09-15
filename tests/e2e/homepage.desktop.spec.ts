import { expect, test } from "@playwright/test";

test("uses a minimal top navbar and expandable side navigation on large screens", async ({ page }) => {
    await page.goto("/");

    const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });

    await expect(primaryNavigation).toBeVisible();
    await expect(primaryNavigation.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(primaryNavigation.getByRole("link", { name: "Join the Bannerlord Coop Discord server" })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "Download" })).toBeVisible();

    for (const name of ["Servers", "Cheats", "Changelog", "Support"]) {
        await expect(primaryNavigation.getByRole("link", { name })).toHaveCount(0);
    }

    const sidePanel = page.getByRole("complementary", { name: "Site navigation" });
    const sideNavigation = sidePanel.getByRole("navigation", { name: "Side navigation" });

    await expect(sidePanel).toBeVisible();

    for (const name of ["Servers", "Cheats", "Changelog", "Support"]) {
        await expect(sideNavigation.getByRole("link", { name })).toBeVisible();
    }

    const collapsedBox = await sidePanel.boundingBox();
    expect(collapsedBox).not.toBeNull();

    await sidePanel.hover();
    await expect.poll(async () => (await sidePanel.boundingBox())?.width ?? 0).toBeGreaterThan(collapsedBox!.width);

    await sideNavigation.getByRole("link", { name: "Servers" }).click();
    await expect(page).toHaveURL(/\/servers$/);
    await expect(page.getByRole("navigation", { name: "Side navigation" }).getByRole("link", { name: "Servers" })).toHaveAttribute("aria-current", "page");
});