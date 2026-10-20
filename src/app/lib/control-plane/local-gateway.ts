import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import { isLoopbackUrl } from "./loopback-origin";

/** The fixed HTTPS origin the Edge handler requires; only the gateway's upstream fetch ever resolves it. */
const PLACEHOLDER_ORIGIN = "https://local-control-plane.invalid";

/** What the gateway reads: the `next dev` signal and the opt-in local control-plane URL. */
export type LocalGatewayEnvironment = { NODE_ENV?: string; CONTROL_PLANE_URL?: string };

/** Thrown when `CONTROL_PLANE_URL` is set under `next dev` but is not a bare loopback HTTP(S) origin. */
export class LocalControlPlaneUrlError extends Error {
    constructor() {
        super("CONTROL_PLANE_URL must be a bare loopback http(s):// origin without credentials, path, query or fragment.");
        this.name = "LocalControlPlaneUrlError";
    }
}

/** Returns the local control-plane origin under `next dev` with `CONTROL_PLANE_URL` set, else null; refuses non-loopback values. */
export function localControlPlaneDestination(environment: LocalGatewayEnvironment): URL | null {
    if (environment.NODE_ENV !== "development") return null;
    const raw = environment.CONTROL_PLANE_URL?.trim();
    if (!raw) return null;
    let destination: URL;
    try {
        destination = new URL(raw);
    } catch {
        throw new LocalControlPlaneUrlError();
    }
    if (destination.protocol !== "http:" && destination.protocol !== "https:") throw new LocalControlPlaneUrlError();
    if (!isLoopbackUrl(destination) || destination.pathname !== "/" || destination.username || destination.password
        || destination.search || destination.hash) throw new LocalControlPlaneUrlError();
    return destination;
}

/** Sends the Edge handler's placeholder-origin calls (path and query) to the local destination; any other target is refused. */
export function createUpstreamFetch(destination: URL, fetchImplementation: typeof fetch): typeof fetch {
    return (input, init) => {
        if (typeof input !== "string" && !(input instanceof URL)) return Promise.reject(new Error("Unexpected upstream request"));
        const url = new URL(input);
        if (url.origin !== PLACEHOLDER_ORIGIN) return Promise.reject(new Error("Unexpected upstream origin"));
        // The query carries routing identity, such as the chunk's `uploadId` and `index`.
        return fetchImplementation(new URL(`${url.pathname}${url.search}`, destination), init);
    };
}

/** Builds the real my-servers Edge handler in process, so `next dev` reaches the local control plane without Edge Functions. */
export function createLocalMyServersHandler(destination: URL, fetchImplementation: typeof fetch = fetch) {
    return createMyServersHandler({
        allowedOrigins: [PLACEHOLDER_ORIGIN],
        controlPlaneUrl: PLACEHOLDER_ORIGIN,
        fetchImplementation: createUpstreamFetch(destination, fetchImplementation),
        // No region alerts are wired locally, so there is no deferred work to keep alive.
        waitUntil: (task) => { void task; },
    });
}
