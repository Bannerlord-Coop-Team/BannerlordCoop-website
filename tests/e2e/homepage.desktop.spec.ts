import { expect, test } from "@playwright/test";

test("uses desktop navigation on large screens", async ({ page }) => {
    await page.goto("/");

    const navigation = page.getByRole("navigation", {name: "Primary navigation",});

    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Servers" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Cheats" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Changelog" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Support" })).toBeVisible();
});