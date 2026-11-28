"use client";

import { VpsHostInventory } from "@/app/components/admin/VpsHostInventory";
import {
    VPS_PAGE_SIZES,
    ownerIdSuggestions,
    filterVpsHosts,
    isVpsPageSize,
    paginateVpsHosts,
    sortVpsHosts,
    useRememberedVpsPageSize,
    vpsOwnerIds,
    vpsRegionOptions,
} from "@/app/lib/control-plane/vps-inventory-query";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";
import { useId, useMemo, useState } from "react";

type VpsInventoryBrowserProps = {
    hosts: HostingAdminVpsHost[];
    ownerLabels?: Readonly<Record<string, string>>;
    liveDataPending?: boolean;
    billingPending?: boolean;
    billingUnavailable?: boolean;
    onRefresh?: () => void;
    runnerTargetSourceCommit: string | null;
    regionCatalog?: readonly HostingRegionPayload[] | null;
};

export function VpsInventoryBrowser(props: VpsInventoryBrowserProps) {
    if (props.hosts.length === 0) return <VpsHostInventory {...inventoryProps(props)} hosts={props.hosts} />;
    return <FilteredVpsInventory {...props} />;
}

function FilteredVpsInventory({
    hosts,
    ownerLabels,
    liveDataPending = false,
    billingPending = false,
    billingUnavailable = false,
    onRefresh,
    runnerTargetSourceCommit,
    regionCatalog = null,
}: VpsInventoryBrowserProps) {
    const [regions, setRegions] = useState<string[]>([]);
    const [ownerId, setOwnerId] = useState("");
    const [emptySlotsOnly, setEmptySlotsOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useRememberedVpsPageSize();
    const regionOptions = useMemo(() => vpsRegionOptions(hosts, regionCatalog), [hosts, regionCatalog]);
    const ownerIds = useMemo(() => vpsOwnerIds(hosts), [hosts]);
    const filtered = useMemo(
        () => filterVpsHosts(hosts, { regions, ownerId, emptySlotsOnly }, regionCatalog),
        [hosts, regions, ownerId, emptySlotsOnly, regionCatalog],
    );
    const pagination = paginateVpsHosts(sortVpsHosts(filtered), page, pageSize);
    const filtersActive = regions.length > 0 || ownerId.trim().length > 0 || emptySlotsOnly;
    const pageSizeId = useId();

    function toggleRegion(region: string) {
        setRegions((current) => current.includes(region) ? current.filter((value) => value !== region) : [...current, region]);
        setPage(1);
    }

    return (
        <div>
            <VpsFilters
                regionOptions={regionOptions}
                regions={regions}
                onToggleRegion={toggleRegion}
                ownerId={ownerId}
                ownerIds={ownerIds}
                onOwnerIdChange={(value) => { setOwnerId(value); setPage(1); }}
                emptySlotsOnly={emptySlotsOnly}
                onEmptySlotsOnlyChange={(value) => { setEmptySlotsOnly(value); setPage(1); }}
            />
            {filtersActive && (
                <p role="status" className="mt-3 text-xs text-foreground-muted">{filtered.length} of {hosts.length} VPS match these filters.</p>
            )}
            {pagination.items.length === 0 ? (
                <div className="mt-6 border border-white/10 bg-surface px-6 py-12 text-center text-sm text-foreground-muted">No VPS hosts match these filters.</div>
            ) : (
                <VpsHostInventory
                    hosts={pagination.items}
                    ownerLabels={ownerLabels}
                    liveDataPending={liveDataPending}
                    billingPending={billingPending}
                    billingUnavailable={billingUnavailable}
                    onRefresh={onRefresh}
                    runnerTargetSourceCommit={runnerTargetSourceCommit}
                    regionCatalog={regionCatalog}
                />
            )}
            <nav aria-label="VPS pages" className="mt-4 flex flex-col gap-3 border border-white/10 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-foreground-muted">{filtered.length === 0 ? "Showing 0 VPS" : `Showing ${pagination.start}–${pagination.end} of ${filtered.length}`}</p>
                <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor={pageSizeId} className="text-xs text-foreground-muted">Rows per page</label>
                    <select
                        id={pageSizeId}
                        value={pageSize}
                        onChange={(event) => {
                            const value = Number(event.target.value);
                            if (!isVpsPageSize(value)) return;
                            setPageSize(value);
                            setPage(1);
                        }}
                        className="min-h-10 border border-white/15 bg-background px-2 text-xs text-foreground outline-none focus:border-gold"
                    >
                        {VPS_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                    <button type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => current - 1)} className="min-h-10 border border-white/15 px-4 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-foreground-muted hover:border-gold/40 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                    <span className="text-xs text-foreground-muted">Page {pagination.page} of {pagination.pageCount}</span>
                    <button type="button" disabled={pagination.page >= pagination.pageCount} onClick={() => setPage((current) => current + 1)} className="min-h-10 border border-white/15 px-4 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-foreground-muted hover:border-gold/40 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                </div>
            </nav>
        </div>
    );
}

function VpsFilters({
    regionOptions,
    regions,
    onToggleRegion,
    ownerId,
    ownerIds,
    onOwnerIdChange,
    emptySlotsOnly,
    onEmptySlotsOnlyChange,
}: {
    regionOptions: readonly { value: string; label: string }[];
    regions: readonly string[];
    onToggleRegion: (region: string) => void;
    ownerId: string;
    ownerIds: readonly string[];
    onOwnerIdChange: (ownerId: string) => void;
    emptySlotsOnly: boolean;
    onEmptySlotsOnlyChange: (value: boolean) => void;
}) {
    const listId = useId();
    const ownerIdInputId = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const suggestions = ownerIdSuggestions(ownerIds, ownerId);
    const showSuggestions = open && suggestions.length > 0;
    const activeIndex = suggestions.length === 0 ? 0 : Math.min(active, suggestions.length - 1);

    function selectOwnerId(value: string) {
        onOwnerIdChange(value);
        setOpen(false);
    }

    return (
        <div className="mt-6 grid gap-4 border border-white/10 bg-surface p-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.8fr)_auto] lg:items-end" role="region" aria-label="VPS filters">
            <fieldset className="min-w-0">
                <legend className="sr-only">Region</legend>
                <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                    Region
                    <span className="ml-2 font-sans text-[0.68rem] font-normal normal-case tracking-normal text-foreground-dim">{regions.length === 0 ? "All regions" : `${regions.length} selected`}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                    {regionOptions.map((option) => {
                        const selected = regions.includes(option.value);
                        return (
                            <label key={option.value} className={`flex cursor-pointer items-center gap-2 border px-2.5 py-1.5 text-xs ${selected ? "border-gold/40 bg-gold/10 text-gold" : "border-white/15 text-foreground-muted hover:border-white/30"}`}>
                                <input
                                    type="checkbox"
                                    name="region"
                                    value={option.value}
                                    checked={selected}
                                    onChange={() => onToggleRegion(option.value)}
                                    className="size-3.5 accent-gold"
                                />
                                {option.label}
                            </label>
                        );
                    })}
                </div>
            </fieldset>
            <div className="relative">
                <label htmlFor={ownerIdInputId} className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted">Owner ID</label>
                <input
                    id={ownerIdInputId}
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showSuggestions}
                    aria-controls={showSuggestions ? listId : undefined}
                    aria-activedescendant={showSuggestions ? `${listId}-option-${activeIndex}` : undefined}
                    value={ownerId}
                    autoComplete="off"
                    placeholder="Filter by owner ID"
                    onChange={(event) => {
                        onOwnerIdChange(event.target.value);
                        setOpen(true);
                        setActive(0);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setOpen(false)}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowDown" && suggestions.length > 0) {
                            event.preventDefault();
                            setOpen(true);
                            setActive((current) => Math.min(current + 1, suggestions.length - 1));
                        } else if (event.key === "ArrowUp" && suggestions.length > 0) {
                            event.preventDefault();
                            setOpen(true);
                            setActive((current) => Math.max(current - 1, 0));
                        } else if (event.key === "Enter" && showSuggestions && suggestions[activeIndex] !== undefined) {
                            event.preventDefault();
                            selectOwnerId(suggestions[activeIndex]);
                        } else if (event.key === "Escape") setOpen(false);
                    }}
                    className="mt-2 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim focus:border-gold"
                />
                {showSuggestions && (
                    <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-auto border border-white/15 bg-surface shadow-lg">
                        {suggestions.map((suggestion, index) => (
                            <li key={suggestion} id={`${listId}-option-${index}`} role="option" aria-selected={index === activeIndex}>
                                <button
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setActive(index)}
                                    onClick={() => selectOwnerId(suggestion)}
                                    className={`w-full px-3 py-2 text-left text-xs ${index === activeIndex ? "bg-gold/10 text-gold" : "text-foreground hover:bg-white/5"}`}
                                >
                                    {suggestion}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <label className="flex items-center gap-3 self-end text-xs text-foreground-muted">
                <input
                    type="checkbox"
                    checked={emptySlotsOnly}
                    onChange={(event) => onEmptySlotsOnlyChange(event.target.checked)}
                    className="size-4 accent-gold"
                />
                Only show VPS with empty slots
            </label>
        </div>
    );
}

function inventoryProps(props: VpsInventoryBrowserProps) {
    return {
        liveDataPending: props.liveDataPending,
        billingPending: props.billingPending,
        billingUnavailable: props.billingUnavailable,
        onRefresh: props.onRefresh,
        runnerTargetSourceCommit: props.runnerTargetSourceCommit,
        regionCatalog: props.regionCatalog,
    };
}
