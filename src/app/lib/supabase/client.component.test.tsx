import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: mocks.create }));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    vi.resetModules();
});

describe("browser Supabase configuration presentation", () => {
    it.each([undefined, "Настройте аутентификацию."])("throws the default or injected diagnostic %s before client creation", async (message) => {
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
        const { getSupabaseBrowserClient } = await import("./client");
        expect(() => getSupabaseBrowserClient(message)).toThrow(message ?? "Authentication is not configured. Add the Supabase environment variables and restart the server.");
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it("retains the singleton and configuration guard regardless of injected presentation", async () => {
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
        const client = { auth: {} };
        mocks.create.mockReturnValue(client);
        const { getSupabaseBrowserClient } = await import("./client");
        expect(getSupabaseBrowserClient("first locale")).toBe(client);
        expect(getSupabaseBrowserClient("second locale")).toBe(client);
        expect(mocks.create).toHaveBeenCalledExactlyOnceWith("https://supabase.example", "test-key");
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
        expect(() => getSupabaseBrowserClient("missing key")).toThrow("missing key");
        expect(mocks.create).toHaveBeenCalledTimes(1);
    });
});
