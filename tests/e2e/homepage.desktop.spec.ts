import { expect, test } from "@playwright/test";

test("uses the complete top navigation on large screens", async ({ page }) => {
    await page.goto("/");

    const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });

    await expect(primaryNavigation).toBeVisible();
    for (const name of ["Home", "Servers", "Cheats"]) {
        await expect(primaryNavigation.getByRole("link", { name, exact: true })).toBeVisible();
    }

    const communityButton = primaryNavigation.getByRole("button", { name: "Community" });
    await communityButton.click();
    await expect(communityButton).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Discord", "Changelog", "Support"]) {
        await expect(primaryNavigation.getByRole("link", { name, exact: true })).toBeVisible();
    }

    const changelogLink = primaryNavigation.getByRole("link", { name: "Changelog", exact: true });
    const triggerBox = await communityButton.boundingBox();
    const linkBox = await changelogLink.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(linkBox).not.toBeNull();
    if (triggerBox && linkBox) {
        await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
        await page.mouse.move(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2, { steps: 10 });
    }
    await expect(changelogLink).toBeVisible();

    await page.getByRole("heading", { name: "Rally The Warband Raise The Banner Conquer Calradia" }).click();
    await expect(communityButton).toHaveAttribute("aria-expanded", "false");
    await expect(primaryNavigation.getByRole("link", { name: "Discord", exact: true })).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Site navigation" })).toHaveCount(0);
});

test("uses the compact navigation without overflowing at laptop widths", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
});
