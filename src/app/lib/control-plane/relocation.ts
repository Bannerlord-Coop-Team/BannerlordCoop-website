import { hostServedRegionKeys } from "./presentation";
import type { HostingAdminVpsHost, HostingJob, ManagedServer } from "./types";
import { hostingRegionLabel, type HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

/** The control plane runs a relocation as a migrate-region job. */
export const RELOCATION_JOB_ACTION = "migrate-region";
const ACTIVE_JOB_STATES = new Set(["queued", "running", "retry-wait"]);

type RelocationHost = Pick<HostingAdminVpsHost, "name" | "countryCode" | "locationId" | "region" | "availableServers" | "occupiedSlots">;

export type RelocationRow = {
    server: ManagedServer;
    hostName: string | null;
    slotIndex: number | null;
    regionLabel: string;
    /** The server's active job, if any; another job blocks relocation until it finishes. */
    activeJob: Pick<HostingJob, "jobId" | "action" | "state"> | null;
};

export type RelocationHostOption = { name: string; freeSlots: number };
export type RelocationRegionOption = { region: string; label: string; freeSlots: number; hosts: RelocationHostOption[] };

/** Joins each server to the VPS slot it occupies and its newest active job. */
export function relocationRows(
    servers: readonly ManagedServer[],
    hosts: readonly RelocationHost[],
    jobs: readonly Pick<HostingJob, "jobId" | "serverId" | "action" | "state" | "createdAt">[],
): RelocationRow[] {
    const slots = new Map<string, { hostName: string; slotIndex: number }>();
    for (const host of hosts) {
        for (const slot of Array.isArray(host.occupiedSlots) ? host.occupiedSlots : []) {
            slots.set(slot.serverId, { hostName: host.name, slotIndex: slot.slotIndex });
        }
    }
    const activeJobs = new Map<string, Pick<HostingJob, "jobId" | "serverId" | "action" | "state" | "createdAt">>();
    for (const job of jobs) {
        if (!ACTIVE_JOB_STATES.has(job.state)) continue;
        const current = activeJobs.get(job.serverId);
        // A relocation is what this view is about, so it wins over any other active job.
        if (current === undefined || (job.action === RELOCATION_JOB_ACTION && current.action !== RELOCATION_JOB_ACTION)
            || (job.action === current.action && job.createdAt > current.createdAt)) activeJobs.set(job.serverId, job);
    }
    return servers.map((server) => {
        const slot = slots.get(server.serverId);
        const job = activeJobs.get(server.serverId);
        return {
            server,
            hostName: slot?.hostName ?? null,
            slotIndex: slot?.slotIndex ?? null,
            regionLabel: hostingRegionLabel(server.friendlyRegion),
            activeJob: job === undefined ? null : { jobId: job.jobId, action: job.action, state: job.state },
        };
    });
}

/**
 * Lists the regions a server could move to, each with the VPS hosts that serve it, excluding the host it is on.
 * Free-slot counts are the inventory's prepared slots; the control plane revalidates admission when the job is queued.
 */
export function relocationTargets(
    hosts: readonly RelocationHost[],
    catalog: readonly HostingRegionPayload[] | null,
    currentHostName: string | null,
): RelocationRegionOption[] {
    const byRegion = new Map<string, RelocationHostOption[]>();
    for (const host of hosts) {
        if (host.name === currentHostName) continue;
        const freeSlots = Number.isSafeInteger(host.availableServers) && host.availableServers > 0 ? host.availableServers : 0;
        for (const region of hostServedRegionKeys(host, catalog)) {
            const regionHosts = byRegion.get(region) ?? [];
            regionHosts.push({ name: host.name, freeSlots });
            byRegion.set(region, regionHosts);
        }
    }
    const order = catalog?.map((entry) => entry.region) ?? [];
    return [...byRegion.entries()]
        .sort(([left], [right]) => rank(order, left) - rank(order, right) || left.localeCompare(right))
        .map(([region, regionHosts]) => ({
            region,
            label: hostingRegionLabel(region),
            freeSlots: regionHosts.reduce((total, host) => total + host.freeSlots, 0),
            hosts: regionHosts.sort((left, right) => left.name.localeCompare(right.name)),
        }));
}

function rank(order: readonly string[], region: string) {
    const index = order.indexOf(region);
    return index === -1 ? order.length : index;
}
