vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
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
    it.each(["capacity_unavailable", "capacity_available", "quota_exhausted", "provider_cannot_assign", "required_approval_missing", "pilot_only", "provisioning_paused"])("preserves the capacity/eligibility message and terminal policy for %s", async (code) => {
        mocks.request.mockRejectedValue(new MyServersApiError(code, "Rejected", false));
        expect(await submitServerOnboarding(intent, "account-a")).toEqual({
            ok: false, retrySameRequest: false,
            message: "No change was made by this request. Capacity or eligibility changed; refresh before choosing again.",
        });
        expect(mocks.revalidate).toHaveBeenCalledWith("/servers");
    });
    it.each([
        { name: "Nightly", request: { ...intent, releaseChannel: "nightly" }, message: "Nightly Release is temporarily unavailable; choose Public Release or try again later." },
        { name: "Public", request: { ...intent, releaseChannel: "stable" }, message: "Public Release is temporarily unavailable; try again later." },
        { name: "default Public", request: intent, message: "Public Release is temporarily unavailable; try again later." },
        { name: "region request", request: { action: "request-region", region: "france", requestId: ONBOARDING_TEST_ID }, message: "Server releases are temporarily unavailable; try again later." },
    ])("maps validated_build_unavailable to truthful $name guidance without retaining a rejected intent", async ({ request, message }) => {
        mocks.request.mockRejectedValue(new MyServersApiError("validated_build_unavailable", "Internal upstream detail", false));
        expect(await submitServerOnboarding(request, "account-a")).toEqual({ ok: false, retrySameRequest: false, message });
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith("current-verified-token", request);
        expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/servers");
    });
    it("releases intent with a region message when the control plane rejects a key outside its catalog", async () => {
        mocks.request.mockRejectedValue(new MyServersApiError("invalid_region", "Unknown region", false));
        expect(await submitServerOnboarding({ ...intent, region: "spain" }, "account-a")).toEqual({
            ok: false, retrySameRequest: false,
            message: "That region is no longer offered, so nothing was created or requested. Refresh and choose another region.",
        });
        expect(mocks.revalidate).toHaveBeenCalledWith("/servers");
    });
});

it("localizes action guidance without changing terminal rejection or exact-retry policy", async () => {
    const { localeDefinitions } = await import("@/app/lib/localization/registry");
    const original = localeDefinitions.en.dictionaries.servers;
    const { default: servers } = await import("@/app/lib/localization/dictionaries/en/servers.json");
    localeDefinitions.en.dictionaries.servers = async () => ({ default: {
        ...servers, "action.noChange": "Localized terminal outcome", "action.unconfirmed": "Localized uncertain outcome",
        "action.accountMismatch": "Localized account mismatch", "action.invalid": "Localized invalid request",
        "action.nightlyUnavailable": "Localized Nightly unavailable", "action.publicReleaseUnavailable": "Localized Public unavailable",
        "action.releaseUnavailable": "Localized releases unavailable",
    } });
    try {
        expect(await submitServerOnboarding({}, "account-a")).toEqual({ ok: false, retrySameRequest: true, message: "Localized invalid request" });
        expect(await submitServerOnboarding(intent, "account-b")).toEqual({ ok: false, retrySameRequest: true, message: "Localized account mismatch" });
        expect(mocks.request).not.toHaveBeenCalled();
        mocks.request.mockRejectedValueOnce(new MyServersApiError("quota_exhausted", "source transport error"));
        expect(await submitServerOnboarding(intent, "account-a")).toEqual({ ok: false, retrySameRequest: false, message: "Localized terminal outcome" });
        for (const [request, message] of [
            [{ ...intent, releaseChannel: "nightly" }, "Localized Nightly unavailable"],
            [intent, "Localized Public unavailable"],
            [{ action: "request-region", region: "france", requestId: ONBOARDING_TEST_ID }, "Localized releases unavailable"],
        ] as const) {
            mocks.request.mockRejectedValueOnce(new MyServersApiError("validated_build_unavailable", "Internal upstream detail", false));
            expect(await submitServerOnboarding(request, "account-a")).toEqual({ ok: false, retrySameRequest: false, message });
        }
        mocks.request.mockRejectedValueOnce(new Error("source transport error"));
        expect(await submitServerOnboarding(intent, "account-a")).toEqual({ ok: false, retrySameRequest: true, message: "Localized uncertain outcome" });
        expect(mocks.request).toHaveBeenLastCalledWith("current-verified-token", intent);
    } finally { localeDefinitions.en.dictionaries.servers = original; }
});
