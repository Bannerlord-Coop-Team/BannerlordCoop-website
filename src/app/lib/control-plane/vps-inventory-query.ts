import { useEffect, useSyncExternalStore } from "react";
import { slotOwnerAccountId } from "@/app/lib/control-plane/presentation";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import type { WebsiteAccountSummary } from "@/app/lib/supabase/users";
import { HOSTING_REGIONS, hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";

export const VPS_PAGE_SIZES = [10, 25, 50, 100] as const;
export type VpsPageSize = (typeof VPS_PAGE_SIZES)[number];
export const VPS_PAGE_SIZE_STORAGE_KEY = "bannerlordcoop.admin.vps.pageSize";
const DEFAULT_VPS_PAGE_SIZE: VpsPageSize = 10;

export type VpsInventoryFilters = {
    regions: readonly string[];
    email: string;
    emptySlotsOnly: boolean;
};

type OccupiedSlot = HostingAdminVpsHost["occupiedSlots"][number];
type EmailLookup = {
    byAccount: Map<string, string>;
    byDiscord: Map<string, string>;
};

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

export function vpsRegionOptions(hosts: readonly Pick<HostingAdminVpsHost, "region">[]) {
    const present = new Set<string>();
    for (const host of hosts) {
        const region = namedRegion(host.region);
        if (region !== null) present.add(region);
    }
    const known = HOSTING_REGIONS
        .filter((option) => present.has(option.key))
        .map((option) => ({ value: option.key, label: option.label }));
    const knownValues = new Set(known.map((option) => option.value));
    const extras = [...present]
        .filter((region) => !knownValues.has(region))
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: hostingRegionLabel(value) }));
    return [...known, ...extras];
}

export type VpsRegionSlotSummary = {
    region: string;
    label: string;
    totalSlots: number;
    takenSlots: number;
};

export type VpsFleetSlotSummary = {
    totalSlots: number;
    takenSlots: number;
    regions: VpsRegionSlotSummary[];
};

/** Counts prepared slots and slots assigned to a server, for the whole fleet and each region. */
export function summarizeVpsSlots(hosts: readonly Pick<HostingAdminVpsHost, "region" | "totalSlots" | "occupiedSlots">[]): VpsFleetSlotSummary {
    const totals = new Map<string, { totalSlots: number; takenSlots: number }>();
    let totalSlots = 0;
    let takenSlots = 0;
    for (const host of hosts) {
        const total = Number.isSafeInteger(host.totalSlots) && host.totalSlots > 0 ? host.totalSlots : 0;
        const taken = Array.isArray(host.occupiedSlots) ? host.occupiedSlots.length : 0;
        totalSlots += total;
        takenSlots += taken;
        const region = namedRegion(host.region) ?? "unknown";
        const current = totals.get(region) ?? { totalSlots: 0, takenSlots: 0 };
        current.totalSlots += total;
        current.takenSlots += taken;
        totals.set(region, current);
    }
    const labels = new Map<string, string>(HOSTING_REGIONS.map((option) => [option.key, option.label]));
    const order = HOSTING_REGIONS.map((option) => option.key);
    const regions = [...totals.entries()]
        .sort(([left], [right]) => {
            const leftRank = order.indexOf(left as typeof order[number]);
            const rightRank = order.indexOf(right as typeof order[number]);
            const rankedLeft = leftRank === -1 ? order.length : leftRank;
            const rankedRight = rightRank === -1 ? order.length : rightRank;
            return rankedLeft - rankedRight || left.localeCompare(right);
        })
        .map(([region, counts]) => ({
            region,
            label: region === "unknown" ? "unknown" : labels.get(region) ?? hostingRegionLabel(region),
            ...counts,
        }));
    return { totalSlots, takenSlots, regions };
}

export function vpsOwnerEmails(hosts: readonly HostingAdminVpsHost[], accounts: readonly WebsiteAccountSummary[]) {
    const lookup = emailLookup(accounts);
    const emails = new Set<string>();
    for (const host of hosts) {
        for (const slot of occupiedSlots(host)) {
            const email = slotOwnerEmail(slot, lookup);
            if (email !== null) emails.add(email);
        }
    }
    return [...emails].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function emailSuggestions(emails: readonly string[], query: string, limit = 8) {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0 || limit <= 0) return [];
    const matches: string[] = [];
    for (const email of emails) {
        if (!email.toLowerCase().includes(needle)) continue;
        matches.push(email);
        if (matches.length === limit) break;
    }
    return matches;
}

export function filterVpsHosts(
    hosts: readonly HostingAdminVpsHost[],
    accounts: readonly WebsiteAccountSummary[],
    filters: VpsInventoryFilters,
) {
    const regions = new Set(filters.regions);
    const needle = filters.email.trim().toLowerCase();
    const lookup = needle.length > 0 ? emailLookup(accounts) : null;
    return hosts.filter((host) => {
        if (regions.size > 0 && (host.region === null || !regions.has(host.region))) return false;
        if (filters.emptySlotsOnly && !hostHasEmptySlot(host)) return false;
        if (lookup !== null && !occupiedSlots(host).some((slot) => {
            const email = slotOwnerEmail(slot, lookup);
            return email !== null && email.toLowerCase().includes(needle);
        })) return false;
        return true;
    });
}

export function paginateVpsHosts<T>(items: readonly T[], page: number, pageSize: number) {
    const safeSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_VPS_PAGE_SIZE;
    const pageCount = Math.max(1, Math.ceil(items.length / safeSize));
    const current = Number.isInteger(page) ? Math.min(Math.max(page, 1), pageCount) : 1;
    const startIndex = (current - 1) * safeSize;
    const slice = items.slice(startIndex, startIndex + safeSize);
    return {
        page: current,
        pageCount,
        start: items.length === 0 ? 0 : startIndex + 1,
        end: startIndex + slice.length,
        items: slice,
    };
}

function emailLookup(accounts: readonly WebsiteAccountSummary[]): EmailLookup {
    const byAccount = new Map<string, string>();
    const byDiscord = new Map<string, string>();
    for (const account of accounts) {
        const email = account.email?.trim() ?? "";
        if (email.length === 0) continue;
        byAccount.set(account.accountId.toLowerCase(), email);
        if (account.discordUserId) byDiscord.set(account.discordUserId, email);
    }
    return { byAccount, byDiscord };
}

function slotOwnerEmail(slot: OccupiedSlot, lookup: EmailLookup) {
    const accountId = slotOwnerAccountId(slot);
    if (accountId !== null) {
        const email = lookup.byAccount.get(accountId.toLowerCase());
        if (email !== undefined) return email;
    }
    return lookup.byDiscord.get(slot.ownerDiscordUserId) ?? null;
}

function occupiedSlots(host: HostingAdminVpsHost) {
    return Array.isArray(host.occupiedSlots) ? host.occupiedSlots : [];
}

function namedRegion(region: string | null) {
    return region !== null && region.length > 0 ? region : null;
}
