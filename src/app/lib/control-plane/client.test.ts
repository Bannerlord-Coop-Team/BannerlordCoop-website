import assert from "node:assert/strict";
import test from "node:test";
import { requestControlPlaneAdmin } from "./client";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test("calls the Supabase Edge Function with the current access token", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key-with-enough-characters";
    let request: Request | undefined;
    globalThis.fetch = async (input, init) => {
        request = new Request(input, init);
        return Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: { healthy: true } });
    };

    try {
        const result = await requestControlPlaneAdmin<{ healthy: boolean }>({
            accessToken: "access-token-with-enough-characters",
            operation: "overview",
            requestId: REQUEST_ID,
        });

        assert.deepEqual(result, { healthy: true });
        assert.equal(request?.url, "https://project.supabase.co/functions/v1/control-plane-admin");
        assert.equal(request?.headers.get("apikey"), "publishable-key-with-enough-characters");
        assert.equal(request?.headers.get("authorization"), "Bearer access-token-with-enough-characters");
        assert.equal(request?.headers.get("content-type"), "application/json");
    } finally {
        globalThis.fetch = ORIGINAL_FETCH;
        restoreEnvironment("NEXT_PUBLIC_SUPABASE_URL", ORIGINAL_URL);
        restoreEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ORIGINAL_KEY);
    }
});

function restoreEnvironment(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
