import { expect, it, vi } from "vitest";
import { withAccessToken } from "./use-vps-readings";

vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: vi.fn() }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: vi.fn() }));

it("sends the request with the looked-up token and the poller's signal", async () => {
    const request = vi.fn(async (accessToken: string) => `read with ${accessToken}`);
    const signal = new AbortController().signal;
    await expect(withAccessToken(async () => "test-token", request)(signal)).resolves.toBe("read with test-token");
    expect(request).toHaveBeenCalledWith("test-token", signal);
});

it("fails with an authentication error and sends nothing when signed out", async () => {
    const request = vi.fn();
    await expect(withAccessToken(async () => null, request)(new AbortController().signal)).rejects.toThrow("Authentication is required.");
    expect(request).not.toHaveBeenCalled();
});

it("sends nothing when the poll was cancelled during the token lookup", async () => {
    const request = vi.fn();
    const controller = new AbortController();
    const read = withAccessToken(async () => { controller.abort(); return "test-token"; }, request);
    await expect(read(controller.signal)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
});
