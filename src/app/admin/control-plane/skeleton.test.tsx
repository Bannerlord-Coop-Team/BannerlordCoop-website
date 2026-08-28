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
