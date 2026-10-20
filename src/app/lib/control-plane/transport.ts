/** Sends one my-servers Edge request; under `next dev` with `CONTROL_PLANE_URL` the server handles it in process instead. */
export async function fetchMyServersEdge(endpoint: URL, init: RequestInit): Promise<Response> {
    // Literal checks: production bundles drop the gateway and its import, and browsers never use it.
    if (process.env.NODE_ENV !== "development") return fetch(endpoint, init);
    if (typeof window !== "undefined") return fetch(endpoint, init);
    const { createLocalMyServersHandler, localControlPlaneDestination } = await import("./local-gateway");
    const destination = localControlPlaneDestination({ NODE_ENV: process.env.NODE_ENV, CONTROL_PLANE_URL: process.env.CONTROL_PLANE_URL });
    if (destination === null) return fetch(endpoint, init);
    return createLocalMyServersHandler(destination)(new Request(endpoint, init));
}
