import { createMyServersHandler } from "../_shared/my-servers.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const allowedOrigins = required("CONTROL_PLANE_WEB_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

Deno.serve(createMyServersHandler({
    allowedOrigins,
    controlPlaneUrl: required("CONTROL_PLANE_ADMIN_URL"),
}));

function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
