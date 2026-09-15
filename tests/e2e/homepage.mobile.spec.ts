import { expect, test } from "@playwright/test";

test("uses mobile navigation on small screens", async ({ page }) => {
    await page.goto("/");

    const menuButton = page.getByRole("button", {name: "Open navigation menu",});

    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const navigation = page.locator("#mobile-navigation");

    await expect(navigation).toBeVisible();
    await expect(page.getByRole("button", { name: "Close navigation menu" }),).toHaveAttribute("aria-expanded", "true");
    await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Servers" })).toBeVisible();
});