import { CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS, ControlPlaneAdminError } from "./client";
import type { HostingAdminVpsInventory } from "./types";

type VpsRead = {
    includeLiveData: boolean;
    includeProviderInventory?: false;
    storedAfter?: string | null;
};

/** Loads the complete registered set in wire pages for the existing fleet filters and summaries. */
export async function readRegisteredVpsInventory(
    read: (input: VpsRead, signal: AbortSignal) => Promise<HostingAdminVpsInventory>,
    includeLiveData: boolean,
    signal?: AbortSignal,
): Promise<HostingAdminVpsInventory> {
    const deadline = AbortSignal.timeout(CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS);
    const scanSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);

    async function scan(): Promise<HostingAdminVpsInventory> {
        const hosts: HostingAdminVpsInventory["hosts"] = [];
        const seen = new Set<string>();
        let storedAfter: string | null = null;
        let runnerTargetSourceCommit: string | undefined;
        for (;;) {
            scanSignal.throwIfAborted();
            let page: HostingAdminVpsInventory;
            try {
                page = await read({ includeLiveData, includeProviderInventory: false, storedAfter }, scanSignal);
            } catch (error) {
                // The old strict request parser refuses the initial paging option with this code.
                if (storedAfter === null && error instanceof ControlPlaneAdminError
                    && error.code === "invalid_request" && !error.retryable) {
                    return read(includeLiveData
                        ? { includeLiveData: true, includeProviderInventory: false }
                        : { includeLiveData: false }, scanSignal);
                }
                throw error;
            }
            if (page.liveDataIncluded !== includeLiveData || !Array.isArray(page.hosts)
                || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor
                    || page.nextCursor === storedAfter || page.hosts.length === 0))) {
                throw new ControlPlaneAdminError("invalid_response", "The VPS inventory page is invalid.");
            }
            for (const host of page.hosts) {
                if (typeof host.name !== "string" || seen.has(host.name)) {
                    throw new ControlPlaneAdminError("invalid_response", "The VPS inventory page repeats a host.");
                }
                seen.add(host.name);
                hosts.push(host);
            }
            runnerTargetSourceCommit = page.runnerTargetSourceCommit ?? runnerTargetSourceCommit;
            if (page.nextCursor === null) {
                return { ...page, hosts, ...(runnerTargetSourceCommit === undefined ? {} : { runnerTargetSourceCommit }) };
            }
            storedAfter = page.nextCursor;
        }
    }

    try {
        return await scan();
    } catch (error) {
        if (!(error instanceof ControlPlaneAdminError)
            || (error.code !== "vps_inventory_changed" && error.code !== "vps_inventory_cursor_expired"
                && error.code !== "vps_inventory_cursor_invalid")) throw error;
        return await scan();
    }
}
