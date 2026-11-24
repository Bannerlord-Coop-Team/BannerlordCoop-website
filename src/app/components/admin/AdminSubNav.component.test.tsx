import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/admin" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
import { AdminSubNav, isAdminLinkActive } from "./AdminSubNav";

/** Renders the sub-navigation into a detached document so links can be queried by role-like attributes. */
function renderAt(pathname: string | null) {
    mocks.pathname = pathname;
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<AdminSubNav />);
    return container;
}

/** Lists the labels of links currently marked as the active page. */
function activeLabels(container: HTMLElement) {
    return [...container.querySelectorAll('a[aria-current="page"]')].map((link) => link.textContent?.trim());
}

beforeEach(() => { mocks.pathname = "/admin"; });

it("labels the admin navigation and links both admin sections with the access badge", () => {
    const container = renderAt("/admin");
    const nav = container.querySelector('nav[aria-label="Administration"]');
    expect(nav).not.toBeNull();
    expect([...nav!.querySelectorAll("a")].map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
        ["Members", "/admin"],
        ["Control Plane", "/admin/control-plane"],
    ]);
    expect(container.textContent).toContain("Admin access");
});

it("marks Members active only on the exact /admin path", () => {
    expect(activeLabels(renderAt("/admin"))).toEqual(["Members"]);
    expect(activeLabels(renderAt("/admin/unknown"))).toEqual([]);
});

it.each(["/admin/control-plane", "/admin/control-plane/servers", "/admin/control-plane?view=jobs"])("marks Control Plane active on %s", (pathname) => {
    expect(activeLabels(renderAt(pathname))).toEqual(["Control Plane"]);
});

it("keeps Members active when the member list carries search parameters", () => {
    expect(activeLabels(renderAt("/admin?q=alice&page=2"))).toEqual(["Members"]);
});

it("does not treat a sibling path that shares the prefix as the control plane", () => {
    expect(activeLabels(renderAt("/admin/control-plane-archive"))).toEqual([]);
});

it("renders without an active link when the pathname is unavailable", () => {
    expect(activeLabels(renderAt(null))).toEqual([]);
});

it("matches sections by path segment rather than by string prefix", () => {
    expect(isAdminLinkActive({ href: "/admin", exact: true }, "/admin/control-plane")).toBe(false);
    expect(isAdminLinkActive({ href: "/admin/control-plane", exact: false }, "/admin/control-plane#jobs")).toBe(true);
    expect(isAdminLinkActive({ href: "/admin/control-plane", exact: false }, "/admin/control-planes")).toBe(false);
});
