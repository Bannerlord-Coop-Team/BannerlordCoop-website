import { beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingCreated, ONBOARDING_TEST_ID } from "../../../tests/onboarding-fixtures";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), request: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser, getSession: mocks.getSession } }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/app/lib/hosting/my-servers", async (original) => ({ ...await original<object>(), requestServerOnboarding: mocks.request }));
import { submitServerOnboarding } from "./onboarding-actions";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
const intent = { action: "create-server", displayName: "My Campaign", region: "us-west", requestId: ONBOARDING_TEST_ID };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "account-a" } } });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "current-verified-token" } } });
    mocks.request.mockResolvedValue(onboardingCreated());
});
describe("onboarding server action authentication and replay policy", () => {
    it("compares expected page user to getUser before dispatch and never accepts a roles bypass", async () => {
        expect(await submitServerOnboarding(intent, "account-b")).toMatchObject({ ok: false, retrySameRequest: true });
        expect(mocks.request).not.toHaveBeenCalled();
        expect(await submitServerOnboarding({ ...intent, roles: ["Admin"] }, "account-a")).toMatchObject({ ok: false, retrySameRequest: true });
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it("forwards only normalized exact request with current session JWT", async () => {
        expect(await submitServerOnboarding({ ...intent, displayName: "  My  Campaign  " }, "account-a")).toEqual({ ok: true, result: onboardingCreated() });
        expect(mocks.request).toHaveBeenCalledWith("current-verified-token", intent);
        expect(mocks.revalidate).toHaveBeenCalledWith("/servers");
    });
    it.each(["missing-user", "missing-session", "auth-throw"])("retains intent on %s", async (condition) => {
        if (condition === "missing-user") mocks.getUser.mockResolvedValue({ data: { user: null } });
        if (condition === "missing-session") mocks.getSession.mockResolvedValue({ data: { session: null } });
        if (condition === "auth-throw") mocks.getUser.mockRejectedValue(new Error("offline"));
        expect(await submitServerOnboarding(intent, "account-a")).toMatchObject({ ok: false, retrySameRequest: true });
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it.each(["request_conflict", "rate_limited", "server_not_found", "invalid_request", "invalid_server_name_length", "invalid_response", "control_plane_unavailable", "hosting_disabled", "unexpected"])("retains exact intent for %s even if retryable=false", async (code) => {
        mocks.request.mockRejectedValue(new MyServersApiError(code, "Not confirmed", false));
        expect(await submitServerOnboarding(intent, "account-a")).toMatchObject({ ok: false, retrySameRequest: true });
    });
    it.each(["capacity_unavailable", "capacity_available", "quota_exhausted", "provider_cannot_assign", "required_approval_missing", "pilot_only", "provisioning_paused", "validated_build_unavailable"])("only releases intent for documented post-receipt-lookup rejection %s", async (code) => {
        mocks.request.mockRejectedValue(new MyServersApiError(code, "Rejected", false));
        expect(await submitServerOnboarding(intent, "account-a")).toMatchObject({ ok: false, retrySameRequest: false });
        expect(mocks.revalidate).toHaveBeenCalledWith("/servers");
    });
});
