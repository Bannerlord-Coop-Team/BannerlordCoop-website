// The gateway's allowlisted public hosts and the fixed public R2 origin it validates artifact URLs against.

export const CANONICAL_GATEWAY_ORIGIN = "https://nightly.bannerlordcoop.com";
export const LEGACY_GATEWAY_ORIGIN = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
export const GATEWAY_ORIGINS: readonly string[] = Object.freeze([CANONICAL_GATEWAY_ORIGIN, LEGACY_GATEWAY_ORIGIN]);
export const PUBLIC_MANUAL_SERVER_ORIGIN = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";

// Picks the allowlisted gateway origin the client called, so every URL handed back stays on that host.
// Any other host (custom routes, previews, spoofed Host headers) falls back to the canonical origin.
export function resolveGatewayOrigin(requestUrl: string | URL): string {
    const origin = new URL(requestUrl).origin;
    return GATEWAY_ORIGINS.includes(origin) ? origin : CANONICAL_GATEWAY_ORIGIN;
}
