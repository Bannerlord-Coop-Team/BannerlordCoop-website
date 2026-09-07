import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerOnboarding } from "./ServerOnboarding";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { onboardingIntentKey, storeOnboardingIntent } from "@/app/servers/onboarding-intent";
import { onboardingSummary, onboardingCreated, onboardingRequested, ONBOARDING_TEST_ID } from "../../../../tests/onboarding-fixtures";
import type { OnboardingSummary } from "../../../../supabase/functions/_shared/server-onboarding-contract";
const mocks = vi.hoisted(() => ({ request: vi.fn(), auth: vi.fn(), refresh: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: mocks.auth }));
vi.mock("@/app/lib/hosting/my-servers", async (original) => ({ ...await original<object>(), requestServerOnboarding: mocks.request }));
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); window.sessionStorage.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "account-a" } } }), getSession: async () => ({ data: { session: { access_token: "synthetic-token" } } }) } });
    mocks.request.mockResolvedValue(onboardingCreated());
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function render(summary: OnboardingSummary | null = onboardingSummary(), userId = "account-a") {
    await act(async () => root.render(<ServerOnboarding summary={summary} userId={userId} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
function button(text: string) {
    const found = [...container.querySelectorAll("button")].find((button) => button.textContent === text);
    expect(found, text).toBeDefined(); return found!;
}
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); }
async function name(value: string) {
    const input = container.querySelector<HTMLInputElement>("#onboarding-server-name")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function choose(region: string) { await act(async () => container.querySelector<HTMLInputElement>(`input[value="${region}"]`)!.click()); }
async function setup() { await render(); await click("Set up server "); }
function stored(user = "account-a") { const raw = sessionStorage.getItem(onboardingIntentKey(user)); return raw ? JSON.parse(raw) : null; }
// Text includes the literal space before the decorative arrow in JSX.
describe("ServerOnboarding real component and server-action recovery", () => {
    it("offers only explicit unused quota and fails safely for unknown or unavailable summary", async () => {
        await render(); expect(container.textContent).toContain("You have a server available"); expect(container.textContent).not.toContain("Patreon");
        for (const summary of [null, { ...onboardingSummary(), unavailableReason: "provisioning_paused" as const }, { ...onboardingSummary(), eligibility: { eligible: false, reason: "no_grant" as const, granted: 0, used: 0, remaining: 0 } }, { ...onboardingSummary(), eligibility: { eligible: false, reason: "quota_exhausted" as const, granted: 1, used: 1, remaining: 0 } }]) {
            await render(summary); expect(container.textContent).not.toContain("You have a server available"); expect(container.textContent).not.toContain("Set up server");
        }
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it("validates normalized name, submits once, reports assigned not running and refreshes real inventory", async () => {
        await setup(); expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(6);
        await name("!bad"); await click("Create server"); expect(mocks.request).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("3–48");
        await name("  My   Campaign  ");
        const submit = button("Create server");
        await act(async () => { submit.click(); submit.click(); });
        expect(mocks.request).toHaveBeenCalledTimes(1);
        expect(mocks.request.mock.calls[0][1]).toMatchObject({ action: "create-server", displayName: "My Campaign", region: "us-west" });
        expect(stored()).toBeNull(); expect(container.textContent).toContain("Server assigned"); expect(container.textContent).toContain("stopped at creation");
        expect(container.textContent).toContain("Discord owner controls");
        expect(container.querySelector("a")?.getAttribute("href")).toBe(`/servers/${ONBOARDING_TEST_ID}`);
        expect(mocks.refresh).toHaveBeenCalled();
    });
    it("requests a full region without sending name or consuming quota and displays persisted requests after reload", async () => {
        mocks.request.mockResolvedValue(onboardingRequested()); await setup(); await choose("france"); await click("Request region");
        expect(mocks.request.mock.calls[0][1]).toMatchObject({ action: "request-region", region: "france" });
        expect(mocks.request.mock.calls[0][1]).not.toHaveProperty("displayName"); expect(container.textContent).toContain("Region request confirmed");
        await click("Done"); const summary = onboardingSummary(); summary.regions[2].request = onboardingRequested().request;
        await render(summary); expect(container.textContent).toContain("France — request saved (outstanding)");
        await click("Set up server "); await choose("france"); expect(button("Region already requested").disabled).toBe(true);
        await choose("us-east"); expect(button("Create server").disabled).toBe(false);
    });
    it.each(["request_conflict", "rate_limited", "server_not_found", "invalid_response"])("retains uncertain create through reload, consumed entitlement and %s, then exact replay", async (code) => {
        mocks.request.mockRejectedValueOnce(new Error("lost after commit")); await setup(); await name("My Campaign"); await click("Create server");
        const original = mocks.request.mock.calls[0][1]; expect(stored()).toEqual(original);
        await act(async () => root.unmount()); root = createRoot(container);
        const consumed = onboardingSummary(); consumed.eligibility = { eligible: false, reason: "quota_exhausted", granted: 1, used: 1, remaining: 0 };
        await render(consumed); mocks.request.mockRejectedValueOnce(new MyServersApiError(code, "Rejected", false));
        await click("Retry pending request"); expect(stored()).toEqual(original);
        await render(null); mocks.request.mockResolvedValueOnce(onboardingCreated()); await click("Retry pending request");
        for (const call of mocks.request.mock.calls) expect(call[1]).toEqual(original);
        expect(stored()).toBeNull(); expect(container.textContent).toContain("Server assigned");
    });
    it("retains uncertain request-region exactly across reload and auth account mismatch", async () => {
        mocks.request.mockRejectedValueOnce(new Error("lost")); await setup(); await choose("france"); await click("Request region");
        const original = stored();
        mocks.auth.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: { id: "account-b" } } }), getSession: async () => ({ data: { session: { access_token: "other-account" } } }) } });
        await click("Retry pending request"); expect(mocks.request).toHaveBeenCalledTimes(1); expect(stored()).toEqual(original);
        await render(onboardingSummary(), "account-b"); expect(container.textContent).not.toContain("Retry pending request"); expect(stored("account-a")).toEqual(original);
        await render(null, "account-a"); mocks.request.mockResolvedValueOnce(onboardingRequested()); await click("Retry pending request");
        expect(mocks.request.mock.calls[1][1]).toEqual(original); expect(stored()).toBeNull();
    });
    it.each(["capacity_unavailable", "capacity_available", "quota_exhausted"])("terminal %s releases intent but requires a fresh snapshot before choosing again", async (code) => {
        mocks.request.mockRejectedValueOnce(new MyServersApiError(code, "race")); await setup(); await name("My Campaign"); await click("Create server");
        expect(stored()).toBeNull(); expect(container.textContent).toContain("No change was made"); expect(button("Create server").disabled).toBe(true);
        await render(onboardingSummary()); expect(button("Create server").disabled).toBe(false);
    });
    it.each(["Escape", "Close"])("closing pending dialog via %s restores fallback focus without cancelling or resubmitting", async (dismiss) => {
        let resolve!: (value: unknown) => void;
        mocks.request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        await render(); button("Set up server ").focus(); await click("Set up server ");
        await name("My Campaign"); await click("Create server"); const original = stored(); expect(original).not.toBeNull();
        expect(button("Set up server ").disabled).toBe(true);
        if (dismiss === "Escape") await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
        else await click("Close (request continues)");
        expect(container.querySelector("dialog")).toBeNull(); expect(document.activeElement).toBe(container.firstElementChild);
        expect(button("Confirming request…").disabled).toBe(true); expect(stored()).toEqual(original); expect(mocks.request).toHaveBeenCalledTimes(1);
        await act(async () => resolve(onboardingCreated())); expect(container.textContent).toContain("Server assigned"); expect(stored()).toBeNull();
        expect(mocks.request).toHaveBeenCalledTimes(1);
    });
    it.each(["Escape", "Close"])("closing uncertain dialog via %s restores fallback focus and preserves exact retry", async (dismiss) => {
        mocks.request.mockRejectedValueOnce(new Error("lost after possible commit"));
        await render(); button("Set up server ").focus(); await click("Set up server ");
        await name("My Campaign"); await click("Create server"); const original = stored(); expect(original).not.toBeNull();
        expect(button("Set up server ").disabled).toBe(true);
        if (dismiss === "Escape") await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
        else await click("Close");
        expect(container.querySelector("dialog")).toBeNull(); expect(document.activeElement).toBe(container.firstElementChild);
        expect(stored()).toEqual(original); expect(mocks.request).toHaveBeenCalledTimes(1);
        await click("Retry pending request"); expect(mocks.request).toHaveBeenCalledTimes(2);
        expect(mocks.request.mock.calls[1][1]).toEqual(original); expect(stored()).toBeNull();
    });
    it("uses fallback when a connected enabled trigger does not accept focus", async () => {
        await render(); const trigger = button("Set up server "); trigger.focus(); await click("Set up server ");
        vi.spyOn(trigger, "focus").mockImplementation(() => {});
        await click("Close"); expect(document.activeElement).toBe(container.firstElementChild);
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it("native dialog cancels via Escape, restores focus and wraps tab edges", async () => {
        await render(); button("Set up server ").focus(); await click("Set up server ");
        const dialog = container.querySelector("dialog")!; expect(dialog.open).toBe(true); expect(document.activeElement?.id).toBe("onboarding-server-name");
        const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close server setup"]')!;
        close.focus(); await act(async () => close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
        expect(document.activeElement).toBe(button("Create server"));
        await act(async () => dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true })));
        expect(container.querySelector("dialog")).toBeNull(); expect(document.activeElement).toBe(button("Set up server ")); expect(mocks.request).not.toHaveBeenCalled();
    });
    it("fails closed on inaccessible or corrupt storage before any mutation", async () => {
        sessionStorage.setItem(onboardingIntentKey("account-a"), "broken"); await render(); expect(button("Set up server ").disabled).toBe(true); expect(container.textContent).toContain("Setup is blocked");
        await render(onboardingSummary(), "account-b"); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
        await click("Set up server "); await name("My Campaign"); await click("Create server"); expect(mocks.request).not.toHaveBeenCalled(); expect(container.textContent).toContain("Setup is blocked");
    });
    it("late response from previous account cannot clear newer retained intent", async () => {
        let resolve!: (value: unknown) => void;
        mocks.request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        await setup(); await name("My Campaign"); await click("Create server");
        const original = stored(); await render(onboardingSummary(), "account-b");
        sessionStorage.removeItem(onboardingIntentKey("account-a"));
        const newer = { ...original, requestId: ONBOARDING_TEST_ID };
        storeOnboardingIntent(sessionStorage, onboardingIntentKey("account-a"), newer);
        await act(async () => resolve(onboardingCreated())); expect(stored("account-a")).toEqual(newer);
        expect(container.textContent).not.toContain("Server assigned");
    });
});
