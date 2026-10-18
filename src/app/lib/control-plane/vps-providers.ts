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
