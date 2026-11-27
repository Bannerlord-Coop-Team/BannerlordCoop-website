import { ControlPlaneAdminError } from "./client";
import type { HostingAdminVpsInventory } from "./types";

// Allow a full control-plane quota window per cursor, even across a long scan.
const MAXIMUM_THROTTLE_RETRIES = 10;
const MAXIMUM_THROTTLE_DELAY_MILLISECONDS = 10_000;

type VpsRead = {
    includeLiveData: boolean;
    includeProviderInventory?: false;
    storedAfter?: string | null;
};

/** Loads the complete registered set in wire pages for the existing fleet filters and summaries. */
export async function readRegisteredVpsInventory(
    read: (input: VpsRead, signal: AbortSignal) => Promise<HostingAdminVpsInventory>,
    includeLiveData: boolean,
    signal = new AbortController().signal,
): Promise<HostingAdminVpsInventory> {
    async function readPage(input: VpsRead) {
        let delay = 1_000;
        for (let retries = 0;; retries++) {
            signal.throwIfAborted();
            try {
                return await read(input, signal);
            } catch (error) {
                if (!(error instanceof ControlPlaneAdminError) || error.code !== "rate_limited"
                    || !error.retryable || retries >= MAXIMUM_THROTTLE_RETRIES) throw error;
                await waitForThrottle(delay, signal);
                delay = Math.min(delay * 2, MAXIMUM_THROTTLE_DELAY_MILLISECONDS);
            }
        }
    }

    async function scan(): Promise<HostingAdminVpsInventory> {
        const hosts: HostingAdminVpsInventory["hosts"] = [];
        const seen = new Set<string>();
        let storedAfter: string | null = null;
        let runnerTargetSourceCommit: string | undefined;
        for (;;) {
            let page: HostingAdminVpsInventory;
            try {
                page = await readPage({ includeLiveData, includeProviderInventory: false, storedAfter });
            } catch (error) {
                // The old strict request parser refuses the initial paging option with this code.
                if (storedAfter === null && error instanceof ControlPlaneAdminError
                    && error.code === "invalid_request" && !error.retryable) {
                    return readPage(includeLiveData
                        ? { includeLiveData: true, includeProviderInventory: false }
                        : { includeLiveData: false });
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

function waitForThrottle(delay: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, delay);
        function abort() {
            clearTimeout(timer);
            reject(signal.reason);
        }
        signal.addEventListener("abort", abort, { once: true });
    });
}
