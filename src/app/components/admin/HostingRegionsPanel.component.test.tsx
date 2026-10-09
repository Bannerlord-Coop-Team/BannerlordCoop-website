import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { request, session, refresh } = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: request,
}));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
import { HostingRegionsPanel } from "./HostingRegionsPanel";
import { hostingRegionCatalogPayload, type HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const stored = (regions: HostingRegionPayload[]) => regions.map((entry) => ({ ...entry, available: true }));
const catalog = (regions = hostingRegionCatalogPayload(), revision = 7, updatedBy: string | null = null) =>
    ({ revision, regions: stored(regions), updatedAt: null, updatedBy });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function publishButton() { return container.querySelector<HTMLButtonElement>('#set-hosting-regions button[type="submit"]')!; }

it("reports a stored catalog equal to the website catalog as in sync, with publishing disabled", () => {
    const html = renderToStaticMarkup(<HostingRegionsPanel catalog={catalog()} error={null} />);
    expect(html).toContain("The stored catalog matches the website catalog.");
    expect(html).toContain("Nothing to publish: the stored catalog matches the website catalog.");
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>.*Unavailable<\/button>/u);
    expect(html.match(/In sync/gu)).toHaveLength(hostingRegionCatalogPayload().length);
});

it("marks missing, extra, changed-placement and reordered regions", () => {
    const regions = hostingRegionCatalogPayload().filter((entry) => entry.region !== "poland").reverse()
        .map((entry) => entry.region === "france" ? { ...entry, placement: { countryCodes: ["FR", "BE"] } } : entry);
    regions.push({ region: "atlantis", placement: { countryCodes: ["JP"] } });
    const html = renderToStaticMarkup(<HostingRegionsPanel catalog={catalog(regions)} error={null} />);
    expect(html).toContain("1 missing, 1 extra, 1 with a different placement, order differs");
    for (const status of ["Missing from control plane", "Not in website catalog", "Placement differs"]) expect(html).toContain(status);
    expect(html).toContain("Atlantis");
    const storedOrder = regions.map((entry) => entry.region).join(", ");
    expect(html).toContain(`Stored order: ${storedOrder}`);
    expect(html).not.toContain("Nothing to publish");
});

it("names the last publisher by website account when the accounts list resolves it", () => {
    const accountId = "4444abcd-4444-4444-8444-444444444444";
    // The control plane records the publishing admin as `supabase:<lowercase uuid>`.
    const actorId = `supabase:${accountId}`;
    const labels = { [accountId]: "admin@example.com" };
    for (const recorded of [actorId, `supabase:${accountId.toUpperCase()}`]) {
        expect(renderToStaticMarkup(<HostingRegionsPanel catalog={catalog(undefined, 7, recorded)} error={null} accountLabels={labels} />))
            .toContain("by admin@example.com");
    }
    // Unresolvable actors are shown as recorded.
    expect(renderToStaticMarkup(<HostingRegionsPanel catalog={catalog(undefined, 7, actorId)} error={null} />)).toContain(`by ${actorId}`);
    expect(renderToStaticMarkup(<HostingRegionsPanel catalog={catalog(undefined, 7, "system:seed")} error={null} accountLabels={labels} />)).toContain("by system:seed");
});

it("publishes exactly the compared website catalog with the read revision and keeps the confirmation once in sync", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const website = hostingRegionCatalogPayload().slice(0, 2);
    request.mockResolvedValue({ revision: 8, regions: stored(website), updatedAt: "2026-10-09T12:00:00.000Z", updatedBy: null });
    await act(async () => root.render(<HostingRegionsPanel catalog={catalog(hostingRegionCatalogPayload())} error={null} website={website} />));
    const reason = container.querySelector<HTMLTextAreaElement>('#set-hosting-regions textarea[name="reason"]')!;
    reason.value = "Trim to the coasts";
    await act(async () => publishButton().click());
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ operation: "set-hosting-regions",
        input: { reason: "Trim to the coasts", expectedRevision: 7, regions: website } });
    expect(refresh).toHaveBeenCalled();
    // The refreshed page now reads the published catalog, which matches the website.
    await act(async () => root.render(<HostingRegionsPanel catalog={catalog(website, 8)} error={null} website={website} />));
    expect(container.querySelector('#set-hosting-regions [role="status"]')?.textContent).toContain("Published the website hosting regions as catalog revision 8.");
    expect(publishButton().disabled).toBe(true);
});

it("shows the read failure instead of a comparison", () => {
    const html = renderToStaticMarkup(<HostingRegionsPanel catalog={null} error="The operation is not supported." />);
    expect(html).toContain("The operation is not supported.");
    expect(html).not.toContain("Publish website regions");
});
