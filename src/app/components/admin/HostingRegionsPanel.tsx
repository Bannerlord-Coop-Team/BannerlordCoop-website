import { ControlPlaneActionCard } from "@/app/components/admin/ControlPlaneActionCard";
import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { operationExplanation } from "@/app/lib/control-plane/explanations";
import { formatAdminActor } from "@/app/lib/control-plane/presentation";
import {
    compareHostingRegionCatalogs,
    formatPlacement,
    hasHostingRegionDrift,
    type HostingRegionDrift,
} from "@/app/lib/control-plane/hosting-region-catalog";
import type { HostingAdminRegionCatalog } from "@/app/lib/control-plane/types";
import {
    hostingRegionCatalogPayload,
    hostingRegionLabel,
    type HostingRegionPayload,
} from "../../../../supabase/functions/_shared/hosting-regions";

/** One comparison row: a key with its website and stored definitions and status. */
type CatalogRow = { region: string; website: HostingRegionPayload | null; stored: HostingRegionPayload | null; status: string; drifted: boolean };

/** Shows the control plane's stored region catalog beside the website catalog and offers to publish the website's. */
export function HostingRegionsPanel({ catalog, error, accountLabels = {}, website = hostingRegionCatalogPayload() }: {
    catalog: HostingAdminRegionCatalog | null;
    error: string | null;
    // Website account names by account ID, used to name who last published.
    accountLabels?: Readonly<Record<string, string>>;
    website?: readonly HostingRegionPayload[];
}) {
    return <section aria-labelledby="hosting-regions-heading">
        <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Owner region catalog</p>
        <h2 id="hosting-regions-heading" className="mt-1 font-display text-3xl font-semibold text-foreground">Hosting regions</h2>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">Owners choose from the control plane&apos;s stored catalog, which matches hosts by each region&apos;s placement. The website catalog supplies labels and continents; publish it after changing the website&apos;s regions.</p>
        {catalog === null
            ? <p role="alert" className="mt-5 border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">{error ?? "The stored hosting-region catalog is unavailable."}</p>
            : <CatalogComparison catalog={catalog} website={website} accountLabels={accountLabels} />}
    </section>;
}

/** Renders the drift summary, the side-by-side table and the publish action, which is disabled while in sync. */
function CatalogComparison({ catalog, website, accountLabels }: {
    catalog: HostingAdminRegionCatalog;
    website: readonly HostingRegionPayload[];
    accountLabels: Readonly<Record<string, string>>;
}) {
    const drift = compareHostingRegionCatalogs(catalog.regions, website);
    const drifted = hasHostingRegionDrift(drift);
    const updatedBy = catalog.updatedBy === null ? null : formatAdminActor(catalog.updatedBy, accountLabels);
    return <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="border border-white/10 bg-surface">
            <div className="border-b border-white/10 px-4 py-3 text-xs text-foreground-muted">
                <p className={drifted ? "text-amber-300" : "text-emerald-300"} role="status">{driftSummary(drift)}</p>
                <p className="mt-1">Stored revision {catalog.revision} · updated <LocalDateTime value={catalog.updatedAt} empty="never (seeded)" />{updatedBy === null ? "" : ` by ${updatedBy}`}</p>
                {drift.orderDiffers && <p className="mt-1">Stored order: {catalog.regions.map((entry) => entry.region).join(", ")}</p>}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-160 text-left text-xs">
                    <thead className="border-b border-white/10 font-label text-[0.6rem] uppercase tracking-[0.12em] text-foreground-muted"><tr><th className="p-3">Region</th><th className="p-3">Website placement</th><th className="p-3">Stored placement</th><th className="p-3">Status</th></tr></thead>
                    <tbody className="divide-y divide-white/10">{catalogRows(catalog.regions, website, drift).map((row) => <tr key={row.region}>
                        <td className="p-3"><span className="font-semibold text-foreground">{hostingRegionLabel(row.region)}</span><span className="mt-1 block font-mono text-[0.62rem] text-foreground-dim">{row.region}</span></td>
                        <td className="p-3 font-mono text-foreground-muted">{row.website === null ? "—" : formatPlacement(row.website.placement)}</td>
                        <td className="p-3 font-mono text-foreground-muted">{row.stored === null ? "—" : formatPlacement(row.stored.placement)}</td>
                        <td className={`p-3 ${row.drifted ? "text-amber-300" : "text-emerald-300"}`}>{row.status}</td>
                    </tr>)}</tbody>
                </table>
            </div>
        </div>
        {/* Always mounted, so its result stays visible after the publish refreshes the page into sync. */}
        <ControlPlaneActionCard operation="set-hosting-regions" title="Publish website regions" destructive help={operationExplanation("set-hosting-regions")}
            description={`Replace the stored catalog (revision ${catalog.revision}) with the website's ${website.length} regions, in website order. Owners can no longer create servers in, or request, a region the website catalog omits; existing servers and requests keep their keys.`}
            destructiveReason="Regions missing from the website catalog stop being offered to owners."
            unavailableReason={drifted ? undefined : "Nothing to publish: the stored catalog matches the website catalog."}
            // The exact website catalog compared above, guarded by the revision it replaces.
            fixedInput={{ expectedRevision: catalog.revision, regions: website }}
            fields={[
                { name: "reason", label: "Reason", kind: "textarea", required: true, placeholder: "Why the catalog is changing (3–1000 characters)", help: "Stored in the immutable administrative audit event." },
            ]} />
    </div>;
}

/** One row per key: website regions in website order, then stored regions the website does not define. */
function catalogRows(stored: readonly HostingRegionPayload[], website: readonly HostingRegionPayload[], drift: HostingRegionDrift): CatalogRow[] {
    const websiteRows = website.map((entry) => {
        const match = stored.find((candidate) => candidate.region === entry.region) ?? null;
        return { region: entry.region, website: entry, stored: match, ...rowStatus(entry.region, match, drift) };
    });
    const extraRows = stored.filter((entry) => drift.extra.includes(entry.region))
        .map((entry) => ({ region: entry.region, website: null, stored: entry, status: "Not in website catalog", drifted: true }));
    return [...websiteRows, ...extraRows];
}

/** Status text for a website region against the stored catalog. */
function rowStatus(region: string, stored: HostingRegionPayload | null, drift: HostingRegionDrift) {
    if (stored === null) return { status: "Missing from control plane", drifted: true };
    if (drift.placementDiffers.includes(region)) return { status: "Placement differs", drifted: true };
    return { status: "In sync", drifted: false };
}

/** One-line description of every kind of drift, or that the catalogs match. */
function driftSummary(drift: HostingRegionDrift): string {
    if (!hasHostingRegionDrift(drift)) return "The stored catalog matches the website catalog.";
    const parts = [
        drift.missing.length > 0 ? `${drift.missing.length} missing` : null,
        drift.extra.length > 0 ? `${drift.extra.length} extra` : null,
        drift.placementDiffers.length > 0 ? `${drift.placementDiffers.length} with a different placement` : null,
        drift.orderDiffers ? "order differs" : null,
    ].filter((part) => part !== null);
    return `The stored catalog differs from the website catalog: ${parts.join(", ")}.`;
}
