import { relocationTargets, type RelocationRegionOption } from "./relocation";
import type { HostingAdminVpsHost, ManagedServer } from "./types";
import { VPS_PROVIDERS, type VpsProviderId } from "./vps-providers";
import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

export const CHANGE_SERVER_REGION_OPERATION = "change-server-region";

export type ChangeServerRegionInput = {
    serverId: string;
    expectedUpdatedAt: string;
    targetRegion: string;
    targetProvider: VpsProviderId;
    targetServiceName: string | null;
    reason: string;
};

export type RegionChangeTarget = RelocationRegionOption & { provider: VpsProviderId };

/** Lists published destinations with a free reported slot on a known provider. */
export function regionChangeTargets(
    hosts: readonly HostingAdminVpsHost[],
    catalog: readonly HostingRegionPayload[] | null,
    server: Pick<ManagedServer, "friendlyRegion">,
    currentHostName: string | null,
): RegionChangeTarget[] {
    if (catalog === null) return [];
    const destinations = VPS_PROVIDERS.flatMap(provider => relocationTargets(
        hosts.filter(host => host.provider === provider && host.availableServers > 0), catalog, currentHostName,
        { includeLegacyRegion: false },
    ).map(target => ({ ...target, provider })));
    return catalog.filter(({ region }) => region !== server.friendlyRegion)
        .flatMap(({ region }) => destinations.filter(target => target.region === region));
}
