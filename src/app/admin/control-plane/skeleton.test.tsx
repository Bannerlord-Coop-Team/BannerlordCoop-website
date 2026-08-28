import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
    ControlPlanePageSkeleton,
    ControlPlaneViewSkeleton,
    type ControlPlaneView,
} from "./skeleton";

const VIEWS: ControlPlaneView[] = [
    "overview",
    "vps",
    "servers",
    "server",
    "jobs",
    "releases",
    "audit",
    "operations",
];

test("the route-level skeleton exposes one accessible loading state", () => {
    const html = renderToStaticMarkup(<ControlPlanePageSkeleton />);

    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-label="Loading control plane"/);
});

test("every control-plane view has a view-specific skeleton", () => {
    for (const view of VIEWS) {
        const html = renderToStaticMarkup(<ControlPlaneViewSkeleton view={view} />);

        assert.match(html, /aria-busy="true"/);
        assert.match(html, new RegExp(`Loading ${view === "vps" ? "VPS" : `${view[0].toUpperCase()}${view.slice(1)}`} data`));
        assert.match(html, /animate-pulse/);
    }
});

test("the overview skeleton mirrors the hydrated statistic rows", () => {
    const html = renderToStaticMarkup(<ControlPlaneViewSkeleton view="overview" />);

    assert.equal(html.match(/bg-surface px-5 py-4/g)?.length, 10);
    assert.match(html, /class="grid gap-px grid-cols-1 sm:grid-cols-2"/);
});
