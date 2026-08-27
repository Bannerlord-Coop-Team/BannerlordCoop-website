import { createControlPlaneAdminHandler } from "../_shared/control-plane-admin.ts";

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const publishableKeys = JSON.parse(required("SUPABASE_PUBLISHABLE_KEYS")) as Record<string, unknown>;
const publishableKey = publishableKeys.default;
if (typeof publishableKey !== "string") throw new Error("Default Supabase publishable key is unavailable");

const allowedOrigins = required("CONTROL_PLANE_WEB_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

Deno.serve(createControlPlaneAdminHandler({
    allowedOrigins,
    supabaseUrl: required("SUPABASE_URL"),
    supabasePublishableKey: publishableKey,
    controlPlaneAdminUrl: required("CONTROL_PLANE_ADMIN_URL"),
}));

function required(name: string) {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}
