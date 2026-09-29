// Local Edge runtime dispatcher; function entrypoints and their authorization remain unchanged.
export {};
declare const Deno: {
    serve(handler: (request: Request) => Promise<Response>): void;
    env: { toObject(): Record<string, string> };
};
declare const EdgeRuntime: {
    userWorkers: { create(options: {
        servicePath: string; memoryLimitMb: number; workerTimeoutMs: number;
        noModuleCache: boolean; envVars: [string, string][];
    }): Promise<{ fetch(request: Request): Promise<Response> }> };
};
const functions = new Set(["my-servers", "public-servers", "website-account", "control-plane-admin"]);

/** Routes the gateway-stripped function path to its production entrypoint in a Deno worker. */
Deno.serve(async (request: Request) => {
    const name = new URL(request.url).pathname.split("/")[1];
    if (!functions.has(name)) return new Response("Function not found", { status: 404 });
    const worker = await EdgeRuntime.userWorkers.create({
        servicePath: `/home/deno/functions/${name}`,
        memoryLimitMb: 150,
        workerTimeoutMs: 60_000,
        noModuleCache: false,
        envVars: Object.entries(Deno.env.toObject()),
    });
    return worker.fetch(request);
});
