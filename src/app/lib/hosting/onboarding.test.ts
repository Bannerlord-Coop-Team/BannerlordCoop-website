import assert from "node:assert/strict";
import test from "node:test";
import { getServerOnboarding, requestServerOnboarding, MyServersApiError } from "./my-servers";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import { onboardingSummary, onboardingCreated, ONBOARDING_TEST_ID } from "../../../../tests/onboarding-fixtures";
import { clearOnboardingIntent, onboardingIntentKey, readOnboardingIntent, storeOnboardingIntent } from "../../servers/onboarding-intent";

const intent = { action: "create-server", displayName: "My Campaign", region: "us-west", requestId: ONBOARDING_TEST_ID } as const;
test("real website facade → real strict Edge → synthetic upstream preserves JWT and durable normalized input", async () => {
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const calls: Record<string, unknown>[] = [];
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key-not-a-secret";
    const edge = createMyServersHandler({ allowedOrigins: ["https://web.example.test"], controlPlaneUrl: "https://backend.example.test", fetchImplementation: async (_url, init) => {
        const body = JSON.parse(init?.body as string); calls.push(body);
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-test-access-token");
        return Response.json({ version: 1, requestId: body.requestId, ok: true, result: body.operation === "server-onboarding" ? onboardingSummary() : onboardingCreated() });
    } });
    globalThis.fetch = async (url, init) => {
        const request = new Request(url, init); assert.equal(request.url.startsWith("https://supabase.example.test/functions/v1/my-servers"), true);
        return edge(request);
    };
    try {
        assert.deepEqual(await getServerOnboarding("synthetic-test-access-token"), onboardingSummary());
        assert.deepEqual(await requestServerOnboarding("synthetic-test-access-token", { ...intent, displayName: "  My   Campaign  ", requestId: ONBOARDING_TEST_ID.toUpperCase() }), onboardingCreated());
        assert.deepEqual(calls[1], { version: 1, requestId: ONBOARDING_TEST_ID, operation: "create-server", input: { displayName: "My Campaign", region: "us-west" } });
        globalThis.fetch = async (_url, init) => Response.json({ version: 1, requestId: new Headers(init?.headers).get("x-request-id"), ok: true, result: { ...onboardingCreated(), credential: "private" } });
        await assert.rejects(requestServerOnboarding("synthetic-test-access-token", intent), (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_response");
        globalThis.fetch = async (_url, init) => Response.json({ version: 1, requestId: new Headers(init?.headers).get("x-request-id"), ok: false, error: { code: "rate_limited", message: "Wait", retryable: false } }, { status: 429 });
        await assert.rejects(requestServerOnboarding("synthetic-test-access-token", intent), (error: unknown) => error instanceof MyServersApiError && error.code === "rate_limited");
    } finally {
        globalThis.fetch = previousFetch;
        if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
        if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    }
});
test("durable onboarding intent survives reload/account switch and compare-clear cannot erase a newer intent", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const key = onboardingIntentKey("user-a");
    storeOnboardingIntent(storage, key, intent);
    assert.deepEqual(readOnboardingIntent(storage, key), intent);
    assert.equal(readOnboardingIntent(storage, onboardingIntentKey("user-b")), null);
    const newer = { ...intent, requestId: "bbbbbbbb-1111-4111-8111-111111111111" };
    assert.throws(() => storeOnboardingIntent(storage, key, newer));
    clearOnboardingIntent(storage, key, intent);
    storeOnboardingIntent(storage, key, newer);
    clearOnboardingIntent(storage, key, intent);
    assert.deepEqual(readOnboardingIntent(storage, key), newer);
    storage.setItem(key, "broken");
    assert.throws(() => readOnboardingIntent(storage, key));
    assert.throws(() => storeOnboardingIntent({ ...storage, setItem: () => { throw new Error("denied"); } }, onboardingIntentKey("new"), intent));
});
