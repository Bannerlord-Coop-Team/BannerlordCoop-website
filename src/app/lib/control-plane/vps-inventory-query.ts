import { useEffect, useSyncExternalStore } from "react";
import { hostServedRegionKeys } from "@/app/lib/control-plane/presentation";
import { classifyRunnerUpdate } from "@/app/lib/control-plane/runner-update-status";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { paginateItems } from "@/app/lib/pagination";
import { HOSTING_REGIONS, hostingRegionLabel, type HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

type RegionCatalog = readonly HostingRegionPayload[] | null;
type PlacedHost = Pick<HostingAdminVpsHost, "countryCode" | "locationId" | "region" | "totalSlots" | "occupiedSlots" | "availableServers">;
const UNPLACED_REGION = "unplaced";

export const VPS_PAGE_SIZES = [10, 25, 50, 100] as const;
export type VpsPageSize = (typeof VPS_PAGE_SIZES)[number];
export const VPS_PAGE_SIZE_STORAGE_KEY = "bannerlordcoop.admin.vps.pageSize";
const DEFAULT_VPS_PAGE_SIZE: VpsPageSize = 10;

export type VpsInventoryFilters = {
    regions: readonly string[];
    ownerId: string;
    emptySlotsOnly: boolean;
};

type OccupiedSlot = HostingAdminVpsHost["occupiedSlots"][number];

const pageSizeListeners = new Set<() => void>();
let rememberedPageSize: VpsPageSize = DEFAULT_VPS_PAGE_SIZE;

export function isVpsPageSize(value: number): value is VpsPageSize {
    return (VPS_PAGE_SIZES as readonly number[]).includes(value);
}

export function readVpsPageSize(storage: Pick<Storage, "getItem">): VpsPageSize {
    try {
        const raw = storage.getItem(VPS_PAGE_SIZE_STORAGE_KEY);
        if (raw === "10" || raw === "25" || raw === "50" || raw === "100") return Number(raw) as VpsPageSize;
    } catch {
        return DEFAULT_VPS_PAGE_SIZE;
    }
    return DEFAULT_VPS_PAGE_SIZE;
}

function subscribeRememberedVpsPageSize(listener: () => void) {
    pageSizeListeners.add(listener);
    return () => pageSizeListeners.delete(listener);
}

function getRememberedVpsPageSize() {
    return rememberedPageSize;
}

function getServerVpsPageSize(): VpsPageSize {
    return DEFAULT_VPS_PAGE_SIZE;
}

function notifyPageSizeListeners() {
    for (const listener of pageSizeListeners) listener();
}

export function setRememberedVpsPageSize(size: VpsPageSize) {
    rememberedPageSize = size;
    try {
        window.localStorage.setItem(VPS_PAGE_SIZE_STORAGE_KEY, String(size));
    } catch {
        // Private browsing can reject storage writes. The current view still uses the chosen size.
    }
    notifyPageSizeListeners();
}

export function restoreRememberedVpsPageSize(storage: Pick<Storage, "getItem">) {
    const restored = readVpsPageSize(storage);
    if (restored === rememberedPageSize) return;
    rememberedPageSize = restored;
    notifyPageSizeListeners();
}

/** Keeps the first render at 10 so server HTML matches hydration, then applies the stored size. */
export function useRememberedVpsPageSize() {
    const pageSize = useSyncExternalStore(subscribeRememberedVpsPageSize, getRememberedVpsPageSize, getServerVpsPageSize);
    useEffect(() => {
        restoreRememberedVpsPageSize(window.localStorage);
    }, []);
    return [pageSize, setRememberedVpsPageSize] as const;
}

export function hostHasEmptySlot(host: Pick<HostingAdminVpsHost, "availableServers">) {
    return Number.isSafeInteger(host.availableServers) && host.availableServers > 0;
}

export function vpsRegionOptions(hosts: readonly PlacedHost[], catalog: RegionCatalog = null) {
    const present = new Set<string>();
    let unplaced = false;
    for (const host of hosts) {
        const keys = hostServedRegionKeys(host, catalog);
        if (keys.length === 0) unplaced = true;
        for (const key of keys) present.add(key);
    }
    const options = [...present]
        .sort((left, right) => compareRegionKeys(left, right, catalog))
        .map((value) => ({ value, label: hostingRegionLabel(value) }));
    return unplaced ? [...options, { value: UNPLACED_REGION, label: "No stored region" }] : options;
}

export type VpsRegionSlotSummary = {
    region: string;
    label: string;
    totalSlots: number;
    takenSlots: number;
    allocatableSlots: number;
};

export type VpsFleetSlotSummary = {
    totalSlots: number;
    takenSlots: number;
    allocatableSlots: number;
    regions: VpsRegionSlotSummary[];
};

export type RegionSlotOutline = "full" | "one-left" | "open";

/** Full regions are red. A region with exactly one slot left is yellow. */
export function regionSlotOutline(takenSlots: number, totalSlots: number): RegionSlotOutline {
    if (!Number.isSafeInteger(totalSlots) || totalSlots <= 0) return "open";
    const taken = Number.isSafeInteger(takenSlots) && takenSlots > 0 ? takenSlots : 0;
    const free = totalSlots - taken;
    if (free <= 0) return "full";
    if (free === 1) return "one-left";
    return "open";
}

/** Counts prepared slots and slots assigned to a server, for the whole fleet and each region it serves. */
export function summarizeVpsSlots(hosts: readonly PlacedHost[], catalog: RegionCatalog = null): VpsFleetSlotSummary {
    const totals = new Map<string, { totalSlots: number; takenSlots: number; allocatableSlots: number }>();
    let totalSlots = 0;
    let takenSlots = 0;
    let allocatableSlots = 0;
    for (const host of hosts) {
        const total = Number.isSafeInteger(host.totalSlots) && host.totalSlots > 0 ? host.totalSlots : 0;
        const taken = Array.isArray(host.occupiedSlots) ? host.occupiedSlots.length : 0;
        totalSlots += total;
        takenSlots += taken;
        allocatableSlots += Number.isSafeInteger(host.availableServers) && host.availableServers > 0 ? host.availableServers : 0;
        const keys = hostServedRegionKeys(host, catalog);
        // A host that satisfies more than one placement is capacity for each of those regions.
        for (const region of keys.length > 0 ? keys : [UNPLACED_REGION]) {
            const current = totals.get(region) ?? { totalSlots: 0, takenSlots: 0, allocatableSlots: 0 };
            current.totalSlots += total;
            current.takenSlots += taken;
            current.allocatableSlots += Number.isSafeInteger(host.availableServers) && host.availableServers > 0 ? host.availableServers : 0;
            totals.set(region, current);
        }
    }
    const regions = [...totals.entries()]
        .sort(([left], [right]) => compareRegionKeys(left, right, catalog))
        .map(([region, counts]) => ({
            region,
            label: region === UNPLACED_REGION ? "No stored region" : hostingRegionLabel(region),
            ...counts,
        }));
    return { totalSlots, takenSlots, allocatableSlots, regions };
}

export function vpsSlotOwnerId(slot: OccupiedSlot) {
    return slot.ownerAccountId ?? slot.ownerDiscordUserId;
}

export function vpsOwnerIds(hosts: readonly HostingAdminVpsHost[]) {
    const ownerIds = new Set<string>();
    for (const host of hosts) {
        for (const slot of occupiedSlots(host)) ownerIds.add(vpsSlotOwnerId(slot));
    }
    return [...ownerIds].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function ownerIdSuggestions(ownerIds: readonly string[], query: string, limit = 8) {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0 || limit <= 0) return [];
    const matches: string[] = [];
    for (const ownerId of ownerIds) {
        if (!ownerId.toLowerCase().includes(needle)) continue;
        matches.push(ownerId);
        if (matches.length === limit) break;
    }
    return matches;
}

export function filterVpsHosts(
    hosts: readonly HostingAdminVpsHost[],
    filters: VpsInventoryFilters,
    catalog: RegionCatalog = null,
) {
    const regions = new Set(filters.regions);
    const needle = filters.ownerId.trim().toLowerCase();
    return hosts.filter((host) => {
        if (regions.size > 0 && !hostMatchesRegions(host, regions, catalog)) return false;
        if (filters.emptySlotsOnly && !hostHasEmptySlot(host)) return false;
        if (needle && !occupiedSlots(host).some(slot => vpsSlotOwnerId(slot).toLowerCase().includes(needle))) return false;
        return true;
    });
}

/** Keeps VPS hosts with a terminal runner error ahead of healthy or in-progress hosts. */
export function sortVpsHosts(hosts: readonly HostingAdminVpsHost[]) {
    return hosts
        .map((host, index) => ({ host, index, errorRank: runnerErrorRank(host) }))
        .sort((left, right) => right.errorRank - left.errorRank || left.index - right.index)
        .map(({ host }) => host);
}

export function paginateVpsHosts<T>(items: readonly T[], page: number, pageSize: number) {
    const safeSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_VPS_PAGE_SIZE;
    return paginateItems(items, page, safeSize);
}

function occupiedSlots(host: HostingAdminVpsHost) {
    return Array.isArray(host.occupiedSlots) ? host.occupiedSlots : [];
}

function runnerErrorRank(host: HostingAdminVpsHost) {
    return host.runnerOnboarding?.state === "failed" || classifyRunnerUpdate(host.runnerUpdate)?.label === "failed" ? 1 : 0;
}

function hostMatchesRegions(host: PlacedHost, regions: ReadonlySet<string>, catalog: RegionCatalog) {
    const keys = hostServedRegionKeys(host, catalog);
    if (keys.length === 0) return regions.has(UNPLACED_REGION);
    return keys.some((key) => regions.has(key));
}

function compareRegionKeys(left: string, right: string, catalog: RegionCatalog) {
    return regionRank(left, catalog) - regionRank(right, catalog) || left.localeCompare(right);
}

function regionRank(region: string, catalog: RegionCatalog) {
    if (region === UNPLACED_REGION) return 10_000;
    const catalogOrder = (catalog ?? []).map((entry) => entry.region);
    const catalogRank = catalogOrder.indexOf(region);
    if (catalogRank !== -1) return catalogRank;
    const websiteOrder: readonly string[] = HOSTING_REGIONS.map((entry) => entry.key);
    const websiteRank = websiteOrder.indexOf(region);
    if (websiteRank !== -1) return catalogOrder.length + websiteRank;
    return catalogOrder.length + websiteOrder.length;
}
