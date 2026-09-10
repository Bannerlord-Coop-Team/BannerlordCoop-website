import { createPublicServersHandler } from "../_shared/public-servers.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};
Deno.serve(createPublicServersHandler({
    allowedOrigins: required("CONTROL_PLANE_WEB_ORIGINS").split(",").map(value => value.trim()).filter(Boolean),
    controlPlaneUrl: required("CONTROL_PLANE_ADMIN_URL"),
}));
function required(name: string): string {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
