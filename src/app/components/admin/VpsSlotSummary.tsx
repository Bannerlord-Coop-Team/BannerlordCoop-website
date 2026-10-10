import { regionSlotOutline, summarizeVpsSlots } from "@/app/lib/control-plane/vps-inventory-query";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

export function VpsSlotSummary({ hosts, regionCatalog = null }: {
    hosts: readonly Pick<HostingAdminVpsHost, "countryCode" | "locationId" | "region" | "totalSlots" | "occupiedSlots">[];
    regionCatalog?: readonly HostingRegionPayload[] | null;
}) {
    const summary = summarizeVpsSlots(hosts, regionCatalog);
    return (
        <section aria-label="Fleet slot capacity" className="mt-6 grid border border-white/10 bg-white/10 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="grid grid-cols-2 bg-surface">
                <SlotTotal label="Total slots" value={summary.totalSlots} help="Prepared slots on registered VPS hosts." />
                <SlotTotal label="Taken slots" value={summary.takenSlots} help="Slots assigned to a server." />
            </div>
            <div className="bg-surface p-5">
                <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-gold">By region</p>
                {summary.regions.length === 0 ? <p className="mt-3 text-xs text-foreground-muted">No registered VPS hosts.</p> : (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {summary.regions.map((region) => (
                            <li key={region.region} className={`border px-3 py-2 ${regionOutlineClass(regionSlotOutline(region.takenSlots, region.totalSlots))}`}>
                                <p className="text-xs text-foreground-muted">{region.label}</p>
                                <p className="mt-1 text-sm text-foreground">
                                    <span className="font-semibold">{region.takenSlots}</span>
                                    <span className="text-foreground-dim"> taken / </span>
                                    <span className="font-semibold">{region.totalSlots}</span>
                                    <span className="text-foreground-dim"> total</span>
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function regionOutlineClass(outline: ReturnType<typeof regionSlotOutline>) {
    if (outline === "full") return "border-crimson";
    if (outline === "one-left") return "border-yellow-400";
    return "border-white/10";
}

function SlotTotal({ label, value, help }: { label: string; value: number; help: string }) {
    return (
        <div className="border-white/10 p-5 first:border-r">
            <p className="cursor-help font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted underline decoration-dotted underline-offset-4" title={help}>{label}</p>
            <p className="mt-2 font-display text-4xl font-semibold text-foreground">{value}</p>
        </div>
    );
}
