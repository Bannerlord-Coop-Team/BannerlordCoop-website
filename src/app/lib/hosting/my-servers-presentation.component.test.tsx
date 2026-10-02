import { afterEach, expect, it, vi } from "vitest";
import { myServersEndpoint, MyServersApiError } from "./my-servers";

const messages = { notConfigured: "localized missing", invalidUrl: "localized URL", invalidKey: "localized key" };
afterEach(() => vi.unstubAllEnvs());

// Keeps endpoint security checks and codes unchanged while injecting website diagnostics.
it.each([
    ["", "x".repeat(20), "notConfigured", "The managed-server API is not configured."],
    ["http://hosting.invalid", "x".repeat(20), "invalidUrl", "The Supabase URL is invalid."],
    ["https://hosting.invalid", "short", "invalidKey", "The Supabase publishable key is invalid."],
] as const)("localizes the %s endpoint failure without changing its code", (url, key, message, english) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    expect(() => myServersEndpoint()).toThrow(english);
    expect(() => myServersEndpoint(messages)).toThrow(messages[message]);
    try { myServersEndpoint(messages); } catch (error) {
        expect(error).toBeInstanceOf(MyServersApiError);
        expect((error as MyServersApiError).code).toBe("server_api_not_configured");
    }
});
