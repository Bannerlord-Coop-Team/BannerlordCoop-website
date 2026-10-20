import { isPermittedOriginScheme } from "./loopback-origin";

/** The reviewed production control-plane origin used when `CONTROL_PLANE_ORIGIN` is not configured. */
export const DEFAULT_CONTROL_PLANE_ORIGIN = "https://control-plane.bannerlordcoop.com";

/** The closed set of control-plane API routes the website calls directly. */
export type ControlPlaneRoute = "/v1/admin/control-plane" | "/v1/user/control-plane" | "/v1/public/control-plane";

/** Thrown when `CONTROL_PLANE_ORIGIN` is set to anything other than a bare absolute HTTPS (or `next dev` loopback HTTP) origin. */
export class ControlPlaneOriginError extends Error {
    constructor() {
        super("CONTROL_PLANE_ORIGIN must be an absolute https:// origin (http:// only for a loopback host under next dev) without credentials, path, query or fragment.");
        this.name = "ControlPlaneOriginError";
    }
}

/** Resolves the server-only control-plane origin: unset or empty uses the production default; anything invalid throws.
 * Loopback HTTP is accepted only under `next dev` (the local hosting sandbox); `nodeEnv` is injectable for tests. */
export function controlPlaneOrigin(raw: string | undefined = process.env.CONTROL_PLANE_ORIGIN, nodeEnv: string | undefined = process.env.NODE_ENV): string {
    if (raw === undefined || raw === "") return DEFAULT_CONTROL_PLANE_ORIGIN;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new ControlPlaneOriginError();
    }
    if (!isPermittedOriginScheme(url, nodeEnv) || url.username || url.password || url.pathname !== "/" || url.search || url.hash
        || raw.includes("?") || raw.includes("#") || raw !== raw.trim()) {
        throw new ControlPlaneOriginError();
    }
    return url.origin;
}

/** Builds the URL of one fixed control-plane route on the validated origin; never accepts a caller-chosen path. */
export function controlPlaneEndpoint(route: ControlPlaneRoute, raw?: string): string {
    return `${controlPlaneOrigin(raw)}${route}`;
}
