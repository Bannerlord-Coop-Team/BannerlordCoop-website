import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { HostingRegionsPanel } from "./HostingRegionsPanel";
import { hostingRegionCatalogPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const catalog = (regions = hostingRegionCatalogPayload()) => ({ revision: 7, regions, updatedAt: null, updatedBy: null });

it("reports a stored catalog equal to the website catalog as in sync, without a publish action", () => {
    const html = renderToStaticMarkup(<HostingRegionsPanel catalog={catalog()} error={null} />);
    expect(html).toContain("The stored catalog matches the website catalog.");
    expect(html).not.toContain("Publish website regions");
    expect(html.match(/In sync/gu)).toHaveLength(hostingRegionCatalogPayload().length);
});

it("marks missing, extra, changed-placement and reordered regions and offers to publish with the current revision", () => {
    const stored = hostingRegionCatalogPayload().filter((entry) => entry.region !== "poland").reverse()
        .map((entry) => entry.region === "france" ? { ...entry, placement: { countryCodes: ["FR", "BE"] } } : entry);
    stored.push({ region: "japan", placement: { countryCodes: ["JP"] } });
    const html = renderToStaticMarkup(<HostingRegionsPanel catalog={catalog(stored)} error={null} />);
    expect(html).toContain("1 missing, 1 extra, 1 with a different placement, order differs");
    for (const status of ["Missing from control plane", "Not in website catalog", "Placement differs"]) expect(html).toContain(status);
    expect(html).toContain("Japan");
    expect(html).toContain("Stored order: united-kingdom, germany, france, us-east, us-west, japan");
    expect(html).toContain("Publish website regions");
    expect(html).toContain('<input type="hidden" name="expectedRevision" value="7"/>');
});

it("shows the read failure instead of a comparison", () => {
    const html = renderToStaticMarkup(<HostingRegionsPanel catalog={null} error="The operation is not supported." />);
    expect(html).toContain("The operation is not supported.");
    expect(html).not.toContain("Publish website regions");
});
