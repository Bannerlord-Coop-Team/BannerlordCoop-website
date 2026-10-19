/** The closed list of VPS provider ids the control plane accepts on host-scoped admin requests. */
export const VPS_PROVIDERS = ["ovhcloud-vps", "contabo-vps"] as const;
export type VpsProviderId = (typeof VPS_PROVIDERS)[number];

/** One VPS host an admin request targets: the provider that owns it and its vendor service name. */
export type VpsHostTarget = { provider: VpsProviderId; serviceName: string };

/** Accepts exactly one known VPS provider id; inventory responses are untrusted input. */
export function isVpsProviderId(value: unknown): value is VpsProviderId {
    return typeof value === "string" && (VPS_PROVIDERS as readonly string[]).includes(value);
}

/** Encodes one listed host as a single form value so its provider travels with its service name. */
export function vpsHostSelectionValue(host: VpsHostTarget): string {
    return JSON.stringify({ provider: host.provider, serviceName: host.serviceName });
}

/** Decodes a form value made by `vpsHostSelectionValue`; anything else is rejected rather than guessed. */
export function parseVpsHostSelection(value: unknown): VpsHostTarget {
    if (typeof value !== "string") throw new Error("Choose a VPS from the list.");
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("Choose a VPS from the list.");
    }
    if (typeof parsed !== "object" || parsed === null) throw new Error("Choose a VPS from the list.");
    const { provider, serviceName } = parsed as Record<string, unknown>;
    if (!isVpsProviderId(provider)) throw new Error("The selected VPS has an unknown provider.");
    if (typeof serviceName !== "string" || serviceName.length < 1 || serviceName.length > 253) {
        throw new Error("The selected VPS has an invalid service name.");
    }
    return { provider, serviceName };
}

const VPS_PROVIDER_LABELS: Record<VpsProviderId, string> = { "ovhcloud-vps": "OVHcloud", "contabo-vps": "Contabo" };

/** Names a provider for display; a retired or unknown id from a historical row is shown verbatim. */
export function vpsProviderLabel(provider: string): string {
    return isVpsProviderId(provider) ? VPS_PROVIDER_LABELS[provider] : provider;
}

/** One enabled provider's account read outcome, as the control plane reports it with VPS inventory. */
export type VpsProviderRead = { provider: VpsProviderId; status: "ok" | "failed"; code: string | null };

/** Describes the provider account reads that failed, or null when every read succeeded or none was made. */
export function failedVpsProviderReadsMessage(reads: readonly VpsProviderRead[] | undefined): string | null {
    const failed = (Array.isArray(reads) ? reads : []).filter((read) => read.status === "failed");
    if (failed.length === 0) return null;
    const names = failed.map((read) => `${vpsProviderLabel(read.provider)}${read.code ? ` (${read.code})` : ""}`);
    return `The ${names.join(", ")} account ${failed.length === 1 ? "read" : "reads"} failed, so ${failed.length === 1 ? "that provider's" : "those providers'"} unregistered VPS products and billing are not shown.`;
}
