import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/admin" }));
vi.mock("next/navigation", () => ({
    usePathname: () => mocks.pathname,
}));
import { AdminSubNav } from "./AdminSubNav";

/** Renders the sub-navigation at a pathname into a detached element for querying. */
function renderAt(pathname: string) {
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

it.each(["/admin/control-plane", "/admin/control-plane/servers"])("marks Control Plane active on %s", (pathname) => {
    expect(activeLabels(renderAt(pathname))).toEqual(["Control Plane"]);
});

it("does not treat a sibling path that shares the prefix as the control plane", () => {
    expect(activeLabels(renderAt("/admin/control-plane-archive"))).toEqual([]);
});
