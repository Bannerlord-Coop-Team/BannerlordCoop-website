// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createMyServersHandler } from "../../../supabase/functions/_shared/my-servers";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as config } from "../../../supabase/functions/_shared/managed-server-configuration";
import { readMyServersResponse } from "@/app/lib/hosting/my-servers";
import { createTranslator } from "@/app/lib/localization/translator";
import messages from "@/app/lib/localization/dictionaries/en/managed-server.json";
import { operateManagedServer } from "./managed-server-actions";
import { readManagedServerConfig, saveManagedServerConfig } from "./managed-server-config-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/localization/server", () => ({ getTranslations: async () => createTranslator("en", messages) }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: { id: "owner" } } }),
    getSession: async () => ({ data: { session: { user: { id: "owner" }, access_token: "synthetic-access-token-with-enough-characters" } } }),
} }) }));

const serverId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const refusal = { code: "server_suspended", message: "This server is suspended. Contact the hosting team for help.", retryable: false };
const file = { configPart: "server", revision: "a".repeat(64), settings: config.serverConfig };
const mutation = { serverId, configPart: "server", expectedRevision: file.revision, settings: file.settings, requestId };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

for (const route of ["start", "stop", "restart-game", "config-get", "config-post"] as const) {
    for (const outcome of ["refused", "masked", "success"] as const) {
        it(`${route}: preserves ${outcome} through real Edge normalization, website parser and action`, async () => {
            vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
            vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key-long-enough");
            const configuration = route.startsWith("config-");
            const calls: Request[] = [];
            let normalized: Response | undefined;
            let websiteRequestId = "";
            const edge = createMyServersHandler({
                allowedOrigins: ["https://bannerlordcoop.com"], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {},
                fetchImplementation: async (input, init) => {
                    const request = new Request(input, init); calls.push(request);
                    const cpRequestId = request.headers.get("x-request-id");
                    if (outcome === "success") return Response.json(configuration
                        ? { ok: true, requestId: cpRequestId, result: file } : { ok: true, result: { exitCode: 0 } });
                    const error = outcome === "refused" ? refusal : { code: configuration ? "configuration_unavailable" : "container_command_unavailable",
                        message: configuration ? "The runner configuration operation could not be confirmed." : "The container command could not be confirmed.", retryable: false };
                    // Exact proposed direct CP shapes: commands unversioned; config versioned/correlated.
                    return Response.json(configuration ? { version: 1, requestId: cpRequestId, ok: false, error }
                        : { ok: false, error }, { status: 409 });
                },
            });
            vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
                const request = new Request(input, init);
                websiteRequestId = request.headers.get("x-request-id")!;
                const response = await edge(request); normalized = response.clone(); return response;
            });
            const result = route === "config-get" ? await readManagedServerConfig(serverId, "server", "owner")
                : route === "config-post" ? await saveManagedServerConfig(mutation, "owner")
                    : await operateManagedServer({ serverId, action: route });
            expect(calls).toHaveLength(1);
            expect(new URL(calls[0].url).pathname).toBe(configuration ? "/api/v1/config" : `/api/v1/${route === "restart-game" ? "restart" : route}`);
            expect(calls[0].method).toBe(route === "config-get" ? "GET" : "POST");
            if (outcome === "refused") {
                expect(normalized!.status).toBe(409);
                expect(await normalized!.clone().json()).toEqual({ version: 1, requestId: websiteRequestId, ok: false, error: refusal });
                await expect(readMyServersResponse(normalized!, websiteRequestId)).rejects.toMatchObject({ ...refusal, parsedEnvelope: true });
                expect(result).toMatchObject({ ok: false, message: messages["action.refusal.serverSuspended"] });
                if (route === "config-post") expect(result).toMatchObject({ notSubmitted: true, reload: false });
                if (!configuration) expect(result).not.toHaveProperty("checkStatus");
            } else if (outcome === "masked") {
                expect(result.ok).toBe(false);
                expect("message" in result && result.message).not.toBe(messages["action.refusal.serverSuspended"]);
                if (!configuration) expect(result).toHaveProperty("checkStatus", true);
            } else expect(result.ok).toBe(true);
        });
    }
}
